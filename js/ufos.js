// Enemy UFOs.
//
// Spawning: never in plain view. New UFOs appear far away (beyond the view
// distance, away from where the player is looking) and fly in; far more of
// them at night. One "UFO activity" setting scales everything from rare
// sightings to a UFO APOCALYPSE, with advanced options under it.
//
// Behavior: UFOs roam anywhere, from just above the ground to high in the
// sky, and play tricks when idle (hovering over lakes, zig-zagging,
// following animals, abducting them with the tractor beam, stopping dead in
// the air). Rarely one shoots off into the sky at enormous speed and is
// gone for good (most likely right after an abduction, or with a jet on its
// tail). A UFO that notices a player on foot (line of sight, then a chance
// that grows the closer they are) races over, stops above them and lifts
// them in a cone of blue light: reach the ship and you're abducted; step
// out of the beam to escape, or shoot it down. They also fire laser blasts.
// Shot at, a UFO reacts: laser volleys, flying in to beam, or evasive
// jinks and altitude changes. Against a player in the jet, each UFO has a
// personality: most flee (a little slower than a jet at full throttle),
// some are faster and escape for good, and fighters attack the jet with
// lasers and aggressive passes. A player flying a UFO is taken for one of
// their own, until they shoot one.
//
// Durability scales with size (small scouts to huge motherships) with some
// variation per UFO. Shot down, a UFO falls burning and trailing smoke,
// crash-lands (crater, debris), and its alien crew climbs out with laser
// guns. The wreck can be boarded and flown (vehicle-ufo.js).
import * as THREE from "three";
import { createUfoModel, designInfo, UFO_DESIGNS } from "./ufo-models.js";
import { TractorBeam } from "./tractor-beam.js";
import { LASER_COLORS } from "./lasers.js";
import { IS_SOLID, IS_WET, BLOCK } from "./blocks.js";
import { SEA_LEVEL } from "./constants.js";
import { effectsQuality } from "./effects.js";

export const UFO_ACTIVITY_LEVELS = [0, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16];
export const UFO_ACTIVITY_NAMES = ["Off", "Very rare", "Rare", "Occasional", "Normal", "Frequent", "Busy skies", "Invasion", "UFO APOCALYPSE"];

export const UFO_DEFAULTS = {
  activity: 1,
  spawnChance: 1,
  maxCount: 0, // 0 = automatic (from the activity)
  aggression: 1,
  detection: 130,
  beamLift: 4,
  sizes: "balanced",
  nightMultiplier: 3,
  toughness: 1,
};

// Per size: radius range (blocks), health, cruise and top speed (blocks/s),
// laser damage, hover height over a beamed player, aliens aboard.
const SIZES = {
  small: { r: [3, 4.5], health: 70, cruise: 16, top: 55, laser: 3, hover: 11, crew: [1, 2] },
  medium: { r: [6, 8.5], health: 180, cruise: 12, top: 45, laser: 4, hover: 14, crew: [2, 4] },
  large: { r: [12, 17], health: 520, cruise: 8, top: 34, laser: 6, hover: 20, crew: [4, 6] },
  mothership: { r: [32, 42], health: 2400, cruise: 5, top: 22, laser: 9, hover: 36, crew: [7, 10] },
};
const SIZE_WEIGHTS = {
  small: { small: 6, medium: 3, large: 0.8, mothership: 0.1 },
  balanced: { small: 4, medium: 4, large: 1.6, mothership: 0.25 },
  big: { small: 2, medium: 4, large: 3, mothership: 0.8 },
};
const DESIGN_LASER = {
  saucer: "green", saucer_dark: "red", tictac: "cyan", sphere: "orange", pyramid: "green",
  triangle: "red", cigar: "orange", ring: "magenta", diamond: "magenta", cubesphere: "blue",
};

const TRICKS = ["hover_lake", "zigzag", "follow", "abduct", "hover", "abduct"];
const MAX_UFOS = 150;
const DESPAWN_DISTANCE = 1100;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function rand(a, b) {
  return a + Math.random() * (b - a);
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
    this.jetMaxSpeed = 150; // the jet's top speed (for fleeing UFOs)
    this.pendingCrews = []; // aliens waiting for their wreck's chunk to load
    this.beams = []; // spare tractor beams
    // Hooks.
    this.onShotDown = null; // (ufo, byPlayer) => void
    this.onAbductPlayer = null; // (ufo) => void
    this.onEscape = null; // (ufo) => void: the player escaped a beam
    this.onMessage = null;
    // Player abduction state.
    this.beamingPlayer = null; // the UFO whose beam holds the player
    this._beamTime = 0;
    this._beamPeak = 0;
    this.lastHum = 0;
  }

  get count() {
    return this.ufos.filter((u) => u.state !== "gone").length;
  }

  // ---------- Settings-derived numbers ----------

  get night() {
    return Math.max(0, Math.min(1, 1 - this.sky.daylight));
  }

  get maxCount() {
    const c = this.config;
    const nightBoost = 1 + (c.nightMultiplier - 1) * 0.35 * this.night;
    const auto = Math.round((4 * c.activity + (c.activity > 0 ? 2 : 0)) * nightBoost);
    return Math.min(MAX_UFOS, c.maxCount > 0 ? c.maxCount : auto);
  }

  // Expected new UFOs per second.
  get spawnRate() {
    const c = this.config;
    return (c.activity / 50) * c.spawnChance * (1 + (c.nightMultiplier - 1) * this.night);
  }

  // ---------- Spawning ----------

  // Spawns a UFO. opts: { design, size, pos, state, personality }.
  spawn(opts = {}) {
    const size = opts.size || pickWeighted(SIZE_WEIGHTS[this.config.sizes] || SIZE_WEIGHTS.balanced);
    const S = SIZES[size] || SIZES.small;
    const design = opts.design || UFO_DESIGNS[Math.floor(Math.random() * UFO_DESIGNS.length)];
    const radius = opts.radius || rand(S.r[0], S.r[1]);
    const model = createUfoModel(design, radius, { castShadow: size !== "mothership" });
    this.scene.add(model.root);
    const variation = rand(0.75, 1.3);
    const maxHealth = Math.round(S.health * variation * this.config.toughness);
    // Personality against a jet: most flee a little slower than the jet,
    // some are faster (they can't be caught), fighters attack.
    const pr = Math.random();
    const personality = opts.personality || (size === "mothership" ? "fighter" : pr < 0.55 ? "evader" : pr < 0.72 ? "fast" : "fighter");
    const u = {
      id: this._id++,
      design,
      size,
      S,
      radius,
      model,
      info: designInfo(design),
      pos: opts.pos ? opts.pos.clone() : new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      spin: rand(-0.6, 0.6),
      health: maxHealth,
      maxHealth,
      personality,
      fleeFactor: personality === "fast" ? rand(1.25, 1.6) : rand(0.8, 0.95),
      state: opts.state || "roam",
      timer: 0,
      waypoint: null,
      trick: null,
      target: null, // a mob being followed / abducted
      beam: null,
      hostile: false, // provoked by a player flying a UFO
      alert: 0, // seconds of being alerted (reacting to hits)
      reaction: null,
      shotT: rand(1, 3),
      checkT: rand(0, 0.5),
      lastSeen: -99,
      hurtTime: 99,
      tilt: new THREE.Vector2(),
      falling: false,
      byPlayer: false,
      light: model.light,
      lazy: 0,
    };
    u.hitHalfHeight = Math.max(u.info.h * radius * 0.55, radius * 0.22);
    this.ufos.push(u);
    this._place(u, 0);
    return u;
  }

  // A spawn point far away, out of view: beyond the view distance and away
  // from where the camera looks, at any altitude.
  _spawnFar() {
    const p = this.player.position;
    const camYaw = this.camera ? new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ").y : 0;
    let a = 0;
    for (let k = 0; k < 8; k++) {
      a = Math.random() * Math.PI * 2;
      // The camera looks along -Z rotated by yaw: angle of that direction.
      const view = Math.atan2(-Math.cos(camYaw), -Math.sin(camYaw));
      const diff = Math.abs(Math.atan2(Math.sin(a - view), Math.cos(a - view)));
      if (diff > 1.3) break;
    }
    const d = Math.max(this.viewDistance + 90, 320) + Math.random() * 180;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    const ground = Math.max(SEA_LEVEL, this.world.heightAt(Math.floor(x), Math.floor(z)));
    return new THREE.Vector3(x, ground + rand(25, 150), z);
  }

  _updateSpawning(dt) {
    if (this.config.activity <= 0) return;
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
    for (let k = 0; k < n; k++) this.spawn({ pos: this._spawnFar() });
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

  // Damages a UFO; the player's shots make it react (and, with the player
  // flying a UFO, turn hostile, maybe with its neighbours).
  damage(u, amount, byPlayer = true, from = null) {
    if (u.state === "gone" || u.falling || amount <= 0) return false;
    u.health -= amount;
    u.hurtTime = 0;
    if (byPlayer) {
      u.byPlayer = true;
      this._provoked(u);
    }
    if (u.health <= 0) this._shotDown(u);
    return true;
  }

  _provoked(u) {
    const pv = this._playerVehicle();
    if (pv?.type === "ufo" && !u.hostile) {
      u.hostile = true;
      for (const o of this.ufos) {
        if (o !== u && !o.hostile && o.pos.distanceTo(u.pos) < 160 && Math.random() < 0.5) o.hostile = true;
      }
    }
    u.lastSeen = this.time;
    u.alert = 8;
    // React (on foot): counterattack, fly in to beam, or evade.
    if (!pv && u.state !== "beam") {
      const w = u.personality === "fighter" ? { counter: 5, beam: 3, evade: 2 } : u.personality === "evader" ? { counter: 2.5, beam: 1.5, evade: 6 } : { counter: 3, beam: 2, evade: 4 };
      const agg = this.config.aggression;
      w.counter *= 0.4 + agg;
      w.beam *= agg * (this.player.creative ? 0 : 1);
      u.reaction = pickWeighted(w);
      u.state = "react";
      u.timer = rand(3, 6);
      u.jink = null;
      if (u.reaction === "beam") u.state = "attack";
    } else if (u.state === "roam" || u.state === "trick") {
      u.state = "attack";
    }
  }

  // ---------- Per frame ----------

  _playerVehicle() {
    return this.vehicles?.active ?? null;
  }

  // Where the player (or their vehicle) is, and how fast it moves.
  _targetInfo() {
    const v = this._playerVehicle();
    if (v) return { pos: v.pos, vel: v.vel, vehicle: v };
    return { pos: this.player.getEyePosition().setY(this.player.position.y + 1), vel: this.player.velocity, vehicle: null };
  }

  _groundAt(x, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    let h = this.world.heightAt(bx, bz);
    if (this.world.getChunk(bx >> 4, bz >> 4)) {
      const s = this.world.surfaceY(bx, bz);
      if (s >= 0) h = Math.max(h, s);
    }
    return Math.max(h + 1, SEA_LEVEL + 1);
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

  update(dt) {
    this.time += dt;
    if (!this.enabled) return;
    this._updateSpawning(dt);
    this._updateCrews(dt);
    const p = this.player.position;
    const tgt = this._targetInfo();
    const night = this.night;
    let humD = Infinity;
    let beamOnPlayer = null;
    for (let i = this.ufos.length - 1; i >= 0; i--) {
      const u = this.ufos[i];
      const dist = u.pos.distanceTo(p);
      if (u.state === "gone" || (dist > DESPAWN_DISTANCE && !u.falling && u.state !== "attack")) {
        this._remove(i);
        continue;
      }
      u.hurtTime += dt;
      // Far away: think every few frames (with the time saved up).
      let step = dt;
      if (dist > 380 && !u.falling && u.state !== "leave") {
        u.lazy += dt;
        if ((Math.floor(this.time * 60) + u.id) % 4 !== 0) {
          this._place(u, 0, dist, night);
          continue;
        }
        step = Math.min(0.2, u.lazy);
        u.lazy = 0;
      }
      if (u.falling) this._fall(u, step);
      else this._think(u, step, tgt, dist);
      if (u.beam) {
        u.beam.update(step, this.effects);
        if (u.beam.on && u === this.beamingPlayer) beamOnPlayer = u;
        if (!u.beam.on && u.beam.strength < 0.02 && u.state !== "beam" && u.state !== "trick") this._freeBeam(u);
      }
      this._place(u, step, dist, night);
      if (dist < humD) humD = dist;
    }
    this._updatePlayerBeam(dt, beamOnPlayer);
    // One engine hum for the nearest UFO.
    this.lastHum = humD;
    if (this.audio?.setUfoHum) this.audio.setUfoHum(humD < 140 ? (1 - humD / 140) * 0.5 : 0, this.beamingPlayer ? 1 : 0);
  }

  _remove(i) {
    const u = this.ufos[i];
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
    const p = this.player.position;
    // Wander around the player's part of the world, any altitude.
    const a = Math.random() * Math.PI * 2;
    const d = rand(20, 420);
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    const ground = this._groundAt(x, z);
    const low = Math.random() < 0.3;
    u.waypoint = new THREE.Vector3(x, ground + u.info.bottom * u.radius + (low ? rand(5, 18) : rand(18, 160)), z);
    u.timer = rand(12, 30);
  }

  _startTrick(u) {
    const trick = TRICKS[Math.floor(Math.random() * TRICKS.length)];
    u.trick = trick;
    u.state = "trick";
    u.target = null;
    if (trick === "hover_lake") {
      // Find open water nearby.
      for (let k = 0; k < 24; k++) {
        const x = u.pos.x + rand(-140, 140);
        const z = u.pos.z + rand(-140, 140);
        if (this.world.heightAt(Math.floor(x), Math.floor(z)) < SEA_LEVEL - 1) {
          u.waypoint = new THREE.Vector3(x, SEA_LEVEL + 1 + u.info.bottom * u.radius + rand(2, 6), z);
          u.timer = rand(14, 24);
          return;
        }
      }
      u.trick = "hover";
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
      if (!best || (trick === "abduct" && u.size === "mothership")) {
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
    if (u.target) u.target.beamedBy = null;
    u.target = null;
    if (u.beam) u.beam.set(false);
    if (this.audio?.playUfoLeave) this.audio.playUfoLeave(u.pos.distanceTo(this.player.position));
  }

  _think(u, dt, tgt, dist) {
    const cfg = this.config;
    u.timer -= dt;
    u.alert = Math.max(0, u.alert - dt);
    u.shotT -= dt;
    const pv = tgt.vehicle;
    const disguised = pv?.type === "ufo" && !u.hostile;

    // Rarely, and more often after an abduction or with a jet on its tail,
    // a UFO leaves forever.
    if (u.state !== "leave") {
      let leaveChance = 0.0004; // per second
      if (pv?.type === "jet" && dist < 350 && u.personality !== "fighter") leaveChance = u.personality === "fast" ? 0.04 : 0.008;
      if (Math.random() < leaveChance * dt) this._leave(u);
    }

    // Noticing the player (line of sight, then a chance that grows the
    // closer they are). Not a player in creative mode or disguised in a UFO.
    u.checkT -= dt;
    if (u.checkT <= 0 && u.state !== "leave") {
      u.checkT = 0.5;
      const range = cfg.detection * (pv?.type === "jet" ? 2.2 : 1);
      const eligible = !this.player.dead && !disguised && (pv || !this.player.creative);
      if (eligible && dist < range && this._canSee(u, tgt.pos)) {
        u.lastSeen = this.time;
        if (u.state === "roam" || u.state === "trick") {
          const closeness = 1 - dist / range;
          const p = 0.35 * cfg.aggression * closeness * (1 + this.night * 0.6) * (this.player.sneaking ? 0.5 : 1) + (pv?.type === "jet" ? 0.25 : 0);
          if (Math.random() < p) {
            u.state = "attack";
            u.timer = 0;
            if (u.trick === "abduct" && u.target) u.target.beamedBy = null;
            u.target = null;
            if (u.beam) u.beam.set(false);
          }
        }
      }
      // Lost interest: no sight of the player for a while.
      if ((u.state === "attack" || u.state === "react" || u.state === "beam") && this.time - u.lastSeen > 14) {
        u.state = "roam";
        u.waypoint = null;
      }
      if (disguised && (u.state === "attack" || u.state === "react" || u.state === "beam")) {
        u.state = "roam";
        u.waypoint = null;
      }
    }

    switch (u.state) {
      case "roam": {
        if (!u.waypoint || u.timer <= 0) this._newWaypoint(u);
        const d = this._steer(u, u.waypoint, u.S.cruise, dt, 1.2);
        if (d < 6) {
          if (Math.random() < 0.55 && dist < 500) this._startTrick(u);
          else this._newWaypoint(u);
        }
        break;
      }
      case "trick":
        this._trick(u, dt);
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

    // Stay above the ground and below the ceiling (not while leaving).
    if (u.state !== "leave") {
      const minY = this._minAltitude(u, u.state === "beam" || u.trick === "hover_lake" || u.trick === "abduct" ? 2 : 4);
      if (u.pos.y < minY) {
        u.pos.y += (minY - u.pos.y) * Math.min(1, dt * 4);
        if (u.vel.y < 0) u.vel.y = 0;
      }
      if (u.pos.y > 320) u.vel.y = Math.min(u.vel.y, 0);
    }
    u.pos.addScaledVector(u.vel, dt);
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
      case "zigzag": {
        u.zig = (u.zig || 0) - dt;
        if (u.zig <= 0) {
          u.zig = rand(0.5, 0.9);
          const a = Math.random() * Math.PI * 2;
          u.vel.set(Math.cos(a) * cruise * 2.4, rand(-0.6, 0.6) * cruise, Math.sin(a) * cruise * 2.4);
        }
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
        const hover = u.info.bottom * u.radius + 10;
        const goal = _w.set(m.pos.x, m.pos.y + hover, m.pos.z);
        const d = this._steer(u, goal, cruise * 1.6, dt, 3);
        const beam = this._getBeam(u);
        const top = _v.set(u.pos.x, u.pos.y - u.info.bottom * u.radius, u.pos.z);
        const ground = this._groundAt(u.pos.x, u.pos.z);
        beam.set(d < 4, top, ground, 2.5 + u.radius * 0.25);
        if (beam.on && beam.strength > 0.5) {
          const took = this.mobs.beamLift(beam, 3.5, top.y - 0.3);
          if (took.length) {
            beam.set(false);
            u.target = null;
            // Satisfied: often it leaves for good right away.
            if (Math.random() < 0.4) this._leave(u);
            else u.timer = 0;
          }
        }
        break;
      }
      default:
        break;
    }
    if (u.timer <= 0 && u.state === "trick") {
      if (u.target) u.target.beamedBy = null;
      if (u.beam) u.beam.set(false);
      u.trick = null;
      u.target = null;
      u.state = "roam";
      this._newWaypoint(u);
    }
  }

  // Leading a moving target: where to aim a bolt of `speed` from `from`.
  _lead(from, pos, vel, speed, out) {
    const d = out.copy(pos).sub(from);
    const t = d.length() / speed;
    return out.copy(pos).addScaledVector(vel, t * 0.85).sub(from).normalize();
  }

  _fireAt(u, target, vel, count = 1) {
    const from = u.pos.clone();
    from.y -= u.info.bottom * u.radius * 0.8;
    const color = LASER_COLORS[DESIGN_LASER[u.design]] || LASER_COLORS.green;
    const speed = 95;
    for (let k = 0; k < count; k++) {
      const dir = this._lead(from, target, vel, speed, new THREE.Vector3());
      const spread = 0.02 + (u.size === "mothership" ? 0.03 : 0);
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      const start = from.clone().addScaledVector(dir, u.radius * 0.8 + 1);
      // Big ships fire from around the hull.
      if (u.radius > 8) start.add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(u.radius * 0.5));
      this.lasers.fire({ from: start, dir, color, speed, damage: u.S.laser, owner: "ufo", source: u, range: 260, radius: 0.1 + u.radius * 0.008, length: 2.4, blast: u.size === "large" || u.size === "mothership" ? 1.4 : 0 });
    }
  }

  _attackOnFoot(u, dt, tgt, dist) {
    const p = this.player.position;
    const hover = u.info.bottom * u.radius + u.S.hover;
    const goal = new THREE.Vector3(p.x, Math.max(p.y + hover, this._minAltitude(u, 3)), p.z);
    const horiz = Math.hypot(u.pos.x - p.x, u.pos.z - p.z);
    // Fly in very fast, slowing near the spot above the player.
    this._steer(u, goal, u.S.top * (horiz > 40 ? 1 : 0.6), dt, 3.5);
    // Laser blasts on the way in.
    if (u.shotT <= 0 && dist < 150 && this._canSee(u, tgt.pos)) {
      u.shotT = rand(1.4, 3) / (0.5 + this.config.aggression * 0.5);
      this._fireAt(u, tgt.pos, tgt.vel, u.size === "mothership" ? 3 : 1);
    }
    if (horiz < 3 + u.radius * 0.1 && Math.abs(u.pos.y - goal.y) < 4 && !this.player.creative && !this.player.dead) {
      u.state = "beam";
      u.timer = rand(12, 20);
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
    this.mobs.beamLift(beam, 3, top.y - 0.3);
    if (!this.beamingPlayer && beam.strength > 0.5 && beam.contains(this.player.position.clone().setY(p.y + 0.9))) {
      this.beamingPlayer = u;
      this._beamTime = 0;
      this._beamStartY = p.y;
      this._beamPeak = 0;
    }
    if (u.shotT <= 0 && this.beamingPlayer !== u && u.timer < 8) {
      u.shotT = rand(2, 3.5);
      this._fireAt(u, tgt.pos, tgt.vel);
    }
    if (u.timer <= 0 || this.player.dead || tgt.vehicle) {
      beam.set(false);
      u.state = "attack";
      u.timer = 0;
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
        held.state = "roam";
        if (held.beam) held.beam.set(false);
        if (this.onAbductPlayer) this.onAbductPlayer(held);
        if (Math.random() < 0.5) this._leave(held);
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
      const want = away.lengthSq() > 1 ? away.normalize().multiplyScalar(THREE.MathUtils.clamp(dist, 25, 45)) : away.set(30, 0, 0);
      const goal = want.add(tgt.pos);
      goal.y = Math.max(tgt.pos.y + 14 + u.radius * 0.4, this._minAltitude(u, 5));
      this._steer(u, goal, u.S.top * 0.6, dt, 3);
      if (u.shotT <= 0) {
        u.shotT = rand(0.22, 0.4);
        this._fireAt(u, tgt.pos, tgt.vel);
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
        this._fireAt(u, tgt.pos, tgt.vel);
      }
    }
    if (u.timer <= 0) {
      u.state = this.player.creative ? "roam" : "attack";
      u.timer = 0;
    }
  }

  // Against a player in a vehicle: evaders flee (most slightly slower than
  // the jet at full throttle, "fast" ones faster), fighters make attack
  // passes with their lasers. Hostile UFOs vs a player flying a UFO fight.
  _attackVehicle(u, dt, tgt, dist) {
    const v = tgt.vehicle;
    const jet = v.type === "jet";
    const flee = jet && u.personality !== "fighter" && !u.hostile;
    if (flee) {
      const topSpeed = this.jetMaxSpeed * u.fleeFactor;
      const away = _w.copy(u.pos).sub(v.pos).normalize();
      // Evasive weaving while running.
      const t = this.time * 1.7 + u.id;
      const side = new THREE.Vector3(-away.z, 0, away.x);
      const dir = away.multiplyScalar(1).addScaledVector(side, Math.sin(t) * 0.45);
      dir.y += Math.sin(t * 1.3) * 0.25;
      const ground = this._minAltitude(u, 8);
      if (u.pos.y < ground + 10) dir.y = Math.abs(dir.y) + 0.3;
      if (u.pos.y > 260) dir.y = -Math.abs(dir.y);
      dir.normalize().multiplyScalar(topSpeed);
      u.vel.lerp(dir, Math.min(1, dt * 1.6));
      // Parting shots now and then.
      if (u.shotT <= 0 && dist < 160 && Math.random() < 0.3) {
        u.shotT = rand(2, 4);
        this._fireAt(u, v.pos, v.vel);
        v.incoming = 2;
      }
      if (dist > 900) {
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
    const topSpeed = jet ? this.jetMaxSpeed * 0.9 : u.S.top;
    this._steer(u, goal, topSpeed, dt, 2.2);
    if (u.shotT <= 0 && dist < 220 && this._canSee(u, v.pos)) {
      u.shotT = rand(0.5, 1.2) / (0.5 + this.config.aggression * 0.5);
      this._fireAt(u, v.pos, v.vel, u.size === "mothership" ? 3 : 1);
      v.incoming = 2;
    }
    // A fighter lining up a head-on pass sets off the warning too.
    if (dist < 220 && u.vel.lengthSq() > 1 && _v.copy(v.pos).sub(u.pos).normalize().dot(_w.copy(u.vel).normalize()) > 0.85) v.incoming = Math.max(v.incoming || 0, 1);
  }

  // ---------- Shot down ----------

  _shotDown(u) {
    u.falling = true;
    u.state = "falling";
    u.health = 0;
    if (u.beam) u.beam.set(false);
    if (this.beamingPlayer === u) this.beamingPlayer = null;
    if (u.target) u.target.beamedBy = null;
    u.fallSpin = rand(1.5, 3.5) * (Math.random() < 0.5 ? -1 : 1);
    u.vel.y = Math.min(u.vel.y, 2);
    u.fireT = 0;
    // A burst of flame where it was hit.
    const fx = this.effects;
    const c = this._fireC || (this._fireC = [new THREE.Color(3, 1.3, 0.3), new THREE.Color(0.8, 0.15, 0.03), new THREE.Color(0.15, 0.13, 0.12), new THREE.Color(0.45, 0.43, 0.4)]);
    for (let i = 0; i < 20 * effectsQuality.scale; i++) {
      fx.glow.spawn({ x: u.pos.x, y: u.pos.y, z: u.pos.z, vx: rand(-8, 8), vy: rand(-2, 8), vz: rand(-8, 8), life: rand(0.4, 0.9), size0: u.radius * 0.5, size1: u.radius * 0.9, color0: c[0], color1: c[1], alpha: 0.5, drag: 2.5 });
    }
    if (this.audio?.playUfoHit) this.audio.playUfoHit(u.pos.distanceTo(this.player.position), true);
    this.onMessage?.(u.byPlayer ? "UFO hit! It's going down!" : "A UFO is going down!");
  }

  _fall(u, dt) {
    u.vel.y -= 16 * dt;
    u.vel.x *= Math.exp(-0.2 * dt);
    u.vel.z *= Math.exp(-0.2 * dt);
    u.yaw += u.fallSpin * dt;
    u.tilt.x += (0.55 * Math.sign(u.fallSpin) - u.tilt.x) * dt;
    u.pos.addScaledVector(u.vel, dt);
    u.model.lightsOn = Math.random() < 0.1 ? 0.6 : 0.03;
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
    // Hit the ground (or water): crash.
    const bottom = u.info.bottom * u.radius;
    const bx = Math.floor(u.pos.x);
    const bz = Math.floor(u.pos.z);
    let hitGround = false;
    if (this.world.getChunk(bx >> 4, bz >> 4)) {
      const id = this.world.getBlock(bx, Math.floor(u.pos.y - bottom), bz);
      hitGround = IS_SOLID[id] || IS_WET[id];
    }
    if (!hitGround) hitGround = u.pos.y - bottom <= Math.max(this.world.heightAt(bx, bz) + 1, SEA_LEVEL);
    if (hitGround || u.pos.y < 0) this._crash(u);
  }

  _crash(u) {
    const fx = this.effects;
    const bottom = u.info.bottom * u.radius;
    const at = u.pos.clone();
    at.y -= bottom * 0.5;
    const radius = Math.min(15, 3.5 + u.radius * 0.6);
    fx.explode(at, { radius, source: "ufo_crash" });
    // The wreck: a boardable, damaged but working UFO sitting in its crater.
    const ground = this._groundAt(at.x, at.z);
    const wreckY = Math.max(ground, at.y - radius * 0.4) + bottom * 0.7;
    const wreck = this.vehicles?.create("ufo", {
      design: u.design,
      radius: u.radius,
      pos: [at.x, wreckY, at.z],
      yaw: u.yaw,
      crashed: true,
      health: Math.round((120 + u.radius * 40) * 0.4),
    });
    if (wreck) wreck.byPlayer = u.byPlayer;
    // Its crew climbs out.
    const [lo, hi] = u.S.crew;
    const crew = lo + Math.floor(Math.random() * (hi - lo + 1));
    this.pendingCrews.push({ pos: new THREE.Vector3(at.x, wreckY, at.z), count: crew, radius: u.radius, delay: 1.2 });
    if (this.onShotDown) this.onShotDown(u, u.byPlayer);
    u.state = "gone";
  }

  // Aliens climb out of a wreck once its ground is loaded.
  _updateCrews(dt) {
    for (let i = this.pendingCrews.length - 1; i >= 0; i--) {
      const c = this.pendingCrews[i];
      c.delay -= dt;
      if (c.delay > 0) continue;
      if (c.pos.distanceTo(this.player.position) > 150) continue;
      const bx = Math.floor(c.pos.x);
      const bz = Math.floor(c.pos.z);
      if (!this.world.getChunk(bx >> 4, bz >> 4)?.meshed) continue;
      let spawned = 0;
      for (let k = 0; k < c.count * 6 && spawned < c.count; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = c.radius * 0.8 + 1.5 + Math.random() * 4;
        const x = Math.floor(c.pos.x + Math.cos(a) * d);
        const z = Math.floor(c.pos.z + Math.sin(a) * d);
        const top = this.world.surfaceY(x, z);
        if (top < 0) continue;
        const id = this.world.getBlock(x, top + 1, z);
        if (IS_SOLID[id] || this.world.getBlock(x, top + 2, z) !== BLOCK.AIR) continue;
        const m = this.mobs.spawn("alien", x + 0.5, top + 1, z + 0.5);
        if (m) {
          m.ai.target = true;
          spawned++;
        }
      }
      if (spawned > 0 && this.audio?.playMob) this.audio.playMob("alien", "idle", c.pos.distanceTo(this.player.position));
      this.pendingCrews.splice(i, 1);
    }
  }

  // ---------- Drawing ----------

  _place(u, dt, dist = u.pos.distanceTo(this.player.position), night = this.night) {
    const m = u.model;
    m.root.position.copy(u.pos);
    if (!u.falling) {
      u.yaw += (u.spin * (u.spinBoost || 1)) * dt;
      u.spinBoost = 1;
      // Bank into the direction of motion.
      const localV = _v.copy(u.vel).applyAxisAngle(_up, -u.yaw);
      const sp = Math.max(4, u.S.top);
      u.tilt.x += (THREE.MathUtils.clamp(localV.z / sp, -1, 1) * 0.35 - u.tilt.x) * Math.min(1, dt * 3);
      u.tilt.y += (THREE.MathUtils.clamp(-localV.x / sp, -1, 1) * 0.35 - u.tilt.y) * Math.min(1, dt * 3);
    }
    const spinning = u.design === "tictac" || u.design === "cigar" || u.design === "triangle";
    // Elongated designs point where they go instead of spinning.
    if (spinning && !u.falling && u.vel.lengthSq() > 1) {
      const heading = Math.atan2(-u.vel.x, -u.vel.z) + Math.PI / 2;
      u.yaw += Math.atan2(Math.sin(heading - u.yaw), Math.cos(heading - u.yaw)) * Math.min(1, dt * 3);
    }
    m.body.rotation.set(u.tilt.x, u.design === "diamond" ? m.body.rotation.y : u.yaw, u.tilt.y, "YXZ");
    m.setFar(dist > 240);
    m.root.visible = dist < 1600;
    // Far away the halo fades in as it approaches (no lights popping in).
    const fade = THREE.MathUtils.clamp((1500 - dist) / 500, 0, 1);
    m.light.sky = 15;
    m.light.block = 0;
    const hurt = Math.max(0, 1 - u.hurtTime / 0.2);
    m.light.flash.setRGB(0.7 * hurt, 0.15 * hurt, 0);
    if (!u.falling) m.lightsOn = 1;
    m.animate(this.time, { night: night * fade, damage: 1 - u.health / u.maxHealth, beam: u.beam?.strength ?? 0, speed: u.vel.length() });
    m.halo.material.opacity *= fade;
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
      this.pendingCrews.length = 0;
      this.beamingPlayer = null;
      if (this.audio?.setUfoHum) this.audio.setUfoHum(0, 0);
    }
  }

  clear() {
    while (this.ufos.length) this._remove(this.ufos.length - 1);
  }
}
