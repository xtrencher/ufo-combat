// Patrol fighters: another air force in a darker paint, fighting the UFOs.
// They patrol the sky and go after UFOs (they never clear the sky for you:
// see HUNT_* below for the limits), and leave the player alone unless the
// player attacks one of them directly: then that fighter (only that one)
// hunts the player for a while, first with missiles from a distance and
// then with its cannon. Missions can also send a hijacked fighter (flown
// for the aliens) that hunts the player from the start. They use the same
// flight model as the player's jet (vehicle-jet.js), flown by a simple
// autopilot: patrol between waypoints, pursue with lead, evade incoming
// missiles with flares and a hard break, and pull up before the ground.
import * as THREE from "three";
import { VehicleManager } from "./vehicles.js";
import { Jet } from "./vehicle-jet.js";
import { WORLD_HEIGHT } from "./constants.js";

export const ENEMY_JET_DEFAULTS = { count: 1 }; // how many patrol at once (0 = none)
const HOSTILE_TIME = 60; // seconds of anger after the player last attacked this fighter
const MISSILE_INTERVAL = 9;
const MAX_JETS = 3;
// Damage causes that don't come from the player.
const NOT_PLAYER = new Set(["ufo_laser", "enemyjet", "enemymissile", "explosion_other", "roguemissile", "crash"]);
// Hunting UFOs: they help the player, but never clear the sky for them:
// weaker guns and missiles against UFOs, engagements with pauses between
// them, a few kills at most per fighter, only small to large ships, never a
// mission's own target, and the UFOs fight back and dodge. Their kills are
// never the player's.
const HUNT_CANNON = 0.45; // their cannon's damage against UFOs
const HUNT_ENGAGE = [35, 55]; // seconds per engagement
const HUNT_PAUSE = [25, 50]; // seconds between engagements
const HUNT_MAX_KILLS = 3;
const SPEED = 1.05; // top speed vs the player's jet at the same settings (they used to be 0.9x)
// Strafing runs at a target on the ground (blocks): attack height above it,
// how far out it turns in, and how close it comes before pulling out.
const STRAFE_HEIGHT = 75;
const STRAFE_OUT = 750;
const STRAFE_BREAK = 120;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q2 = new THREE.Vector3();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export class EnemyJet extends Jet {
  constructor(manager, data = {}) {
    // (A hijacked fighter, sent by a mission, flies for the aliens.)
    const hijacked = !!data.hijacked;
    super(manager, { ...data, airborne: true }, { type: "enemyjet", name: hijacked ? "Hijacked fighter" : "Patrol fighter", paint: hijacked ? "enemy" : "patrol", maxHealth: 120 });
    this.hijacked = hijacked;
    this.isEnemyJet = true;
    this.unusable = true; // can't be boarded
    this.transient = true; // never saved
    this.cannonOwner = "enemyjet";
    this.hostile = false;
    this.provoked = 0; // seconds left of anger from being attacked
    this.aiState = "patrol";
    this.ai = { wp: null, wpT: 0, burstT: 0, burstLeft: 0, breakT: 0, breakDir: 1, missileT: 4 + Math.random() * 6, flareLeft: 0, lostT: 0 };
    // Patrols hunt UFOs (engagements with pauses between them).
    this.hunt = { ufo: null, t: 0, pause: 8 + Math.random() * 20, kills: 0, missile: false, checkT: 0 };
    this.throttle = 0.7;
    this.age = 0;
    this.keepWreck = false;
    this.cameraModes = ["chase"];
  }

  // An attack by the player makes this fighter (only this one) hostile; hits
  // from a UFO it is fighting (or a stray blast) don't.
  damage(amount, cause = "vehicle", byPlayer = false) {
    const other = NOT_PLAYER.has(cause);
    const ok = super.damage(amount, cause, byPlayer);
    if (ok && !this.alive && other) this.downedByOther = true;
    if (ok && this.alive && !other) {
      if (this.provoked <= 0 && !this.hijacked) this.manager.onMessage?.("You attacked a patrol fighter: it's coming after you!");
      this.provoked = HOSTILE_TIME;
      this.hunt.ufo = null;
    }
    return ok;
  }

  get cfg() {
    // A little faster than the player's jet at the same settings.
    const base = this.manager.config.jet || { maxSpeed: 160, accel: 1, turnRate: 1, stallSpeed: 42, assist: true };
    if (this._cfgBase !== base || this._cfgMax !== base.maxSpeed || this._cfgAccel !== base.accel) {
      this._cfgBase = base;
      this._cfgMax = base.maxSpeed;
      this._cfgAccel = base.accel;
      this._cfg = { ...base, maxSpeed: Math.min(base.maxSpeed, 260) * SPEED, stallSpeed: base.stallSpeed ?? 42, turnRate: 0.9, accel: base.accel * 1.1, assist: true, aimAssist: true };
    }
    return this._cfg;
  }

  serialize() {
    return null;
  }

  _player() {
    const mgr = this.manager;
    return { pos: mgr.player.vehicle ? mgr.player.vehicle.pos : mgr.player.position, vel: mgr.player.vehicle ? mgr.player.vehicle.vel : mgr.player.velocity };
  }

  // ---------- Autopilot ----------

  _autopilot(dt, stick) {
    const mgr = this.manager;
    const ai = this.ai;
    this.age += dt;
    this.flareT = Math.max(0, this.flareT - dt);
    ai.missileT = Math.max(0, ai.missileT - dt);
    this.provoked = Math.max(0, this.provoked - dt);
    const fwd = this.forward(_v);
    const P = this._player();
    const toP = _w.copy(P.pos).sub(this.pos);
    const dist = toP.length();
    const hostile = (this.hijacked || this.provoked > 0) && !mgr.player.dead;
    this.hostile = hostile;
    let wantYaw = this.aimYaw;
    let wantPitch = this.aimPitch;
    let throttle = 0.7;
    let ab = false;
    // How far above the ground it is, now and a moment ahead along its path.
    const lookT = 2.4 + this.speed * 0.012;
    // (Several points along the path: a hill in the middle would be missed by looking only at the end.)
    let highest = mgr.groundBelow(this.pos.x, WORLD_HEIGHT, this.pos.z);
    for (const f of [0.35, 0.7, 1]) {
      const ahead = _q2.copy(this.pos).addScaledVector(this.vel, lookT * f);
      highest = Math.max(highest, mgr.groundBelow(ahead.x, WORLD_HEIGHT, ahead.z));
    }
    const groundClear = this.pos.y - highest;

    // Incoming missiles (the player's): break and drop flares.
    let threat = null;
    for (const v of mgr.vehicles) {
      if (!v.missiles || v === this) continue;
      for (const m of v.missiles) if (m.target && m.target.ref === this && !m.hostile && m.pos.distanceTo(this.pos) < 900) threat = m;
    }
    this.warn = threat ? { dist: threat.pos.distanceTo(this.pos), kind: "missile" } : null;
    if (threat && ai.breakT <= 0) {
      ai.breakT = 2.6;
      ai.breakDir = Math.random() < 0.5 ? -1 : 1;
      ai.flareLeft = 2;
    }
    if (ai.breakT > 0) {
      ai.breakT -= dt;
      // A hard turn across the missile's path, with a dive or a climb.
      const d = threat ? _w.copy(threat.pos).sub(this.pos).normalize() : fwd;
      wantYaw = Math.atan2(-d.x, -d.z) + ai.breakDir * 1.5;
      wantPitch = ai.breakDir * 0.35;
      throttle = 1;
      ab = true;
      if (ai.flareLeft > 0 && this.flareT <= 0 && threat && threat.pos.distanceTo(this.pos) < 650) {
        this._launchFlares();
        ai.flareLeft--;
      }
    } else if (hostile) {
      const speed = Math.max(60, this.speed);
      const lead = dist / (speed + 100);
      const lowTarget = P.pos.y < this.pos.y + 80;
      const angle = _q2.copy(P.pos).sub(this.pos).normalize().angleTo(fwd); // to the target itself
      const aim = _w.copy(P.pos).addScaledVector(P.vel, lead * 0.6);
      const flat = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      if (lowTarget) {
        // Strafing runs against a target on (or near) the ground: out to
        // attack height, turn in, a shallow run with the nose on the target
        // (the guns fire on the way in), pull out over it and extend again.
        if (ai.run === "extend") {
          const ax = this.pos.x - P.pos.x;
          const az = this.pos.z - P.pos.z;
          const al = Math.hypot(ax, az) || 1;
          aim.set(P.pos.x + (ax / al) * 900, P.pos.y + STRAFE_HEIGHT, P.pos.z + (az / al) * 900);
          if (flat > STRAFE_OUT) ai.run = "attack";
        } else {
          ai.run = "attack";
          if (angle > 0.7) {
            // Still turning in: level, at attack height, fast.
            aim.y = clamp(this.pos.y, P.pos.y + STRAFE_HEIGHT - 15, P.pos.y + STRAFE_HEIGHT + 35);
          } else {
            aim.y += 1; // the nose on the target (the chest)
          }
          if (flat < STRAFE_BREAK || (angle > 1.2 && flat < 320)) ai.run = "extend";
        }
      } else {
        ai.run = null;
      }
      aim.sub(this.pos);
      const aimDist = aim.length();
      aim.divideScalar(aimDist || 1);
      wantYaw = Math.atan2(-aim.x, -aim.z);
      wantPitch = Math.asin(clamp(aim.y, -1, 1));
      throttle = 1;
      ab = ai.run === "attack" ? angle > 0.7 : dist > 350;
      if (!lowTarget && dist < 90 && angle > 0.5) {
        // (Air to air: break off rather than ram.)
        wantYaw += 1.2;
        wantPitch = 0.4;
      }
      if (lowTarget) wantPitch = Math.max(wantPitch, -0.55);
      // Guns: bursts when the nose is on the target.
      ai.burstT -= dt;
      if (dist < 600 && angle < (lowTarget ? 0.06 : 0.07) && ai.burstT <= 0 && !this.jammed) {
        // (Short bursts at someone on foot: a strafing run hurts, it doesn't shred.)
        ai.burstLeft = lowTarget ? 4 + Math.floor(Math.random() * 3) : 14 + Math.floor(Math.random() * 10);
        ai.burstT = 2.2 + Math.random() * 2;
      }
      if (ai.burstLeft > 0 && this.cannonT <= 0 && !this.jammed) {
        ai.burstLeft--;
        this._fireCannon(fwd);
      }
      // Missiles: from a distance, with the nose roughly on the target.
      if (ai.missileT <= 0 && dist > 200 && dist < 1500 && angle < 0.55 && this.missileT <= 0) {
        ai.missileT = MISSILE_INTERVAL + Math.random() * 5;
        this.missileT = 1;
        this._launchMissile({ kind: "player", ref: mgr.player }, { hostile: true });
        mgr.onMessage?.("ENEMY MISSILE LAUNCH!");
      }
    } else if (this._hunting(dt)) {
      // Hunting a UFO.
      const u = this.hunt.ufo;
      const toU = _w.copy(u.pos).sub(this.pos);
      const ud = toU.length();
      const speed = Math.max(60, this.speed);
      const aim = _q2.copy(u.pos).addScaledVector(u.vel, (ud / (speed + 700)) * 0.9).sub(this.pos).normalize();
      const angle = toU.normalize().angleTo(fwd);
      wantYaw = Math.atan2(-aim.x, -aim.z);
      wantPitch = Math.asin(clamp(aim.y, -1, 1));
      throttle = 1;
      ab = ud > 450;
      // Break off before ramming it, come round again.
      if (ud < 70 + u.radius * 1.5) {
        wantYaw += 1.2;
        wantPitch = 0.45;
      }
      ai.burstT -= dt;
      if (ud < 650 && angle < 0.08 && ai.burstT <= 0 && !this.jammed) {
        ai.burstLeft = 10 + Math.floor(Math.random() * 8);
        ai.burstT = 2.5 + Math.random() * 2;
      }
      if (ai.burstLeft > 0 && this.cannonT <= 0 && !this.jammed) {
        ai.burstLeft--;
        this.cannonOwner = "rogue";
        this.cannonScale = HUNT_CANNON;
        this._fireCannon(fwd);
        this.cannonOwner = "enemyjet";
        this.cannonScale = 1;
      }
      // One missile per engagement, from a distance.
      if (!this.hunt.missile && ud > 250 && ud < 1200 && angle < 0.4 && this.missileT <= 0) {
        this.hunt.missile = true;
        this.missileT = 1;
        this._launchMissile({ kind: "ufo", ref: u }, { rogue: true });
      }
    } else {
      // Patrol: waypoints on a wide ring around the player, at altitude.
      ai.wpT -= dt;
      if (!ai.wp || ai.wpT <= 0 || this.pos.distanceTo(ai.wp) < 180) {
        const R = clamp(mgr.viewRange ? mgr.viewRange * 0.85 : 300, 220, 800);
        const a = Math.random() * Math.PI * 2;
        const around = mgr.player.position;
        const gx = around.x + Math.cos(a) * R * (0.6 + Math.random() * 0.8);
        const gz = around.z + Math.sin(a) * R * (0.6 + Math.random() * 0.8);
        const g = mgr.world.heightAt(Math.floor(gx), Math.floor(gz));
        ai.wp = new THREE.Vector3(gx, clamp(g + 90 + Math.random() * 70, 110, 320), gz);
        ai.wpT = 30;
      }
      const d = _w.copy(ai.wp).sub(this.pos).normalize();
      wantYaw = Math.atan2(-d.x, -d.z);
      wantPitch = Math.asin(clamp(d.y, -1, 1)) * 0.8;
      throttle = 0.65;
    }

    // Terrain: pull up before the ground (looking ahead along the flight
    // path). On a strafing run it goes lower, watching its sink rate.
    const strafing = hostile && ai.run === "attack";
    const floor = strafing ? 20 + this.speed * 0.08 - Math.min(0, this.vel.y) * 2.2 : 45 + this.speed * 0.3;
    if (groundClear < floor && this.vel.y < 30) {
      if (strafing) ai.run = "extend";
      wantPitch = Math.max(wantPitch, clamp((110 - groundClear) / 70, 0.2, 1));
      throttle = 1;
    }
    if (this.pos.y > 360) wantPitch = Math.min(wantPitch, -0.1);
    // Fly toward the wanted direction (the assist steers the stick from the aim).
    let dy = wantYaw - this.aimYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.aimYaw += dy * Math.min(1, dt * 6);
    this.aimPitch += (clamp(wantPitch, -1.2, 1.2) - this.aimPitch) * Math.min(1, dt * 6);
    this.throttle += clamp(throttle - this.throttle, -dt * 0.5, dt * 0.6);
    this.afterburner = ab;
    if (ab) this.throttle = 1;
    this._assistStick(stick);
  }

  // Is it hunting a UFO right now? Picks one now and then (never while
  // angry at the player), gives up after a while.
  _hunting(dt) {
    const h = this.hunt;
    const mgr = this.manager;
    const ufos = mgr.ufos;
    if (this.hijacked || !ufos || h.kills >= HUNT_MAX_KILLS) return false;
    if (h.ufo) {
      const u = h.ufo;
      h.t -= dt;
      const gone = u.falling || u.state === "gone" || u.state === "leave" || !ufos.ufos.includes(u);
      if (gone || h.t <= 0) {
        if (u.falling && !u.byPlayer) h.kills++;
        h.ufo = null;
        h.pause = HUNT_PAUSE[0] + Math.random() * (HUNT_PAUSE[1] - HUNT_PAUSE[0]);
        return false;
      }
      return true;
    }
    h.pause -= dt;
    h.checkT -= dt;
    if (h.pause > 0 || h.checkT > 0) return false;
    h.checkT = 4;
    // Now and then it just carries on with its patrol.
    if (Math.random() < 0.3) {
      h.pause = 15 + Math.random() * 20;
      return false;
    }
    // A UFO it can see, not too big, somewhere the player can see it too.
    let best = null;
    let bestD = 1300;
    const p = mgr.player.position;
    for (const u of ufos.ufos) {
      if (u.falling || u.state === "gone" || u.state === "leave" || u.state === "emerge" || u.S.idx > 2 || u.missionTarget || u.raider) continue;
      if (u.pos.distanceTo(p) > Math.max(400, (mgr.viewRange || 400) * 0.9)) continue;
      const d = u.pos.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (!best) return false;
    h.ufo = best;
    h.t = HUNT_ENGAGE[0] + Math.random() * (HUNT_ENGAGE[1] - HUNT_ENGAGE[0]);
    h.missile = false;
    return true;
  }

  // A hostile fighter aims at the player, a hunting one at its UFO.
  _assistDir(from, fwd, speed) {
    if (this.hunt?.ufo && this.cannonOwner === "rogue") {
      const u = this.hunt.ufo;
      const d = _w.copy(u.pos).sub(from);
      const dist = d.length();
      if (dist < 20 || dist > 1100) return fwd.clone();
      if (d.clone().normalize().angleTo(fwd) > 0.1) return fwd.clone();
      const aim = u.pos.clone().addScaledVector(u.vel, dist / speed).sub(from).normalize();
      return fwd.clone().lerp(aim, 0.6).normalize();
    }
    const P = this._player();
    const d = _w.copy(P.pos).sub(from);
    const dist = d.length();
    if (dist < 20 || dist > 1100) return fwd.clone();
    const ang = d.clone().normalize().angleTo(fwd);
    if (ang > 0.12) return fwd.clone();
    const target = P.pos.clone().addScaledVector(P.vel, dist / speed);
    const onFoot = !this.manager.player.vehicle;
    if (onFoot) target.y += 1; // (the chest)
    const aim = target.sub(from).normalize();
    return onFoot ? aim.clone() : fwd.clone().lerp(aim, 0.7).normalize(); // (on foot: short bursts, see _autopilot; moving makes them miss)
  }

  onDestroyed(cause) {
    // A crash counts for the player only while it was hunting them (they
    // outflew it); anything else not done by the player isn't theirs.
    if (NOT_PLAYER.has(cause) && !(cause === "crash" && (this.hijacked || this.provoked > 0))) this.downedByOther = true;
    super.onDestroyed(cause);
    this.manager.enemyJets?.onDown(this, cause);
  }
}

VehicleManager.register("enemyjet", EnemyJet);

// Spawns and removes the patrols.
export class EnemyJetManager {
  constructor({ vehicles, ufos, player, world }) {
    this.vehicles = vehicles;
    this.ufos = ufos;
    this.player = player;
    this.world = world;
    this.config = { ...ENEMY_JET_DEFAULTS };
    this.enabled = true;
    this.timer = 20 + Math.random() * 30;
    this.reinforceT = 0;
    this.onDown = () => {};
    this.downed = 0;
    this.allowed = () => true; // Survival: patrols only once the player has jets (set by the game)
    vehicles.enemyJets = this;
  }

  get jets() {
    return this.vehicles.vehicles.filter((v) => v.isEnemyJet && v.alive);
  }

  spawn(opts = {}) {
    const p = this.player.position;
    const R = opts.dist ?? clamp((this.vehicles.viewRange || 300) * 1.2, 320, 900);
    const a = opts.angle ?? Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(a) * R;
    const z = p.z + Math.sin(a) * R;
    const g = this.world.heightAt(Math.floor(x), Math.floor(z));
    const y = Math.max(g + 110, 130) + Math.random() * 40;
    // Flying across (tangent), or straight at the player when hostile.
    // (opts.hostile: a hijacked fighter, flown for the aliens: a mission's.)
    const yaw = opts.toward || opts.hostile ? Math.atan2(-(p.x - x), -(p.z - z)) : Math.atan2(Math.sin(a), -Math.cos(a)) + (Math.random() - 0.5);
    const jet = this.vehicles.create("enemyjet", { pos: [x, y, z], yaw, airborne: true, speed: 110, throttle: 0.7, hijacked: !!opts.hostile });
    if (jet && opts.hostile) this.vehicles.onMessage?.("HIJACKED FIGHTER INBOUND! The aliens have taken one of ours.");
    return jet;
  }

  update(dt) {
    const veh = this.vehicles;
    if (!veh.enabled || !this.enabled) {
      for (const j of this.jets) veh.remove(j);
      return;
    }
    const jets = this.jets;
    for (const j of jets) {
      // Far away for good: gone.
      if (j.pos.distanceTo(this.player.position) > 4200) veh.remove(j);
    }
    const max = this.allowed() ? Math.min(MAX_JETS, Math.round(this.config.count)) : 0;
    // (A mission's fighter stays whatever the setting says.)
    if (jets.length > max) {
      const extra = jets.find((j) => !j.mission);
      if (extra) veh.remove(extra);
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 45 + Math.random() * 60;
      if (jets.length < max && !this.player.dead) this.spawn({});
    }
  }

  clear() {
    for (const j of this.jets) this.vehicles.remove(j);
  }
}
