// Enemy fighter jets: the aliens' air force. They patrol the sky in a
// darker paint and leave the player alone (neutral) until the player attacks
// them, or attacks the UFOs they guard; then they hunt the player, first with
// missiles from a distance and then with their cannon. They use the same
// flight model as the player's jet (vehicle-jet.js), flown by a simple
// autopilot: patrol between waypoints, pursue with lead, evade incoming
// missiles with flares and a hard break, and pull up before the ground.
import * as THREE from "three";
import { VehicleManager } from "./vehicles.js";
import { Jet } from "./vehicle-jet.js";
import { WORLD_HEIGHT } from "./constants.js";

export const ENEMY_JET_DEFAULTS = { count: 1 }; // how many patrol at once (0 = none)
const HOSTILE_TIME = 60; // seconds of anger after the player last attacked a UFO or a jet
const MISSILE_INTERVAL = 9;
const MAX_JETS = 3;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q2 = new THREE.Vector3();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export class EnemyJet extends Jet {
  constructor(manager, data = {}) {
    super(manager, { ...data, airborne: true }, { type: "enemyjet", name: "Hostile fighter", paint: "enemy", maxHealth: 120 });
    this.isEnemyJet = true;
    this.unusable = true; // can't be boarded
    this.transient = true; // never saved
    this.cannonOwner = "enemyjet";
    this.hostile = false;
    this.provoked = 0; // seconds left of anger from being attacked
    this.aiState = "patrol";
    this.ai = { wp: null, wpT: 0, burstT: 0, burstLeft: 0, breakT: 0, breakDir: 1, missileT: 4 + Math.random() * 6, flareLeft: 0, lostT: 0 };
    this.throttle = 0.7;
    this.age = 0;
    this.keepWreck = false;
    this.cameraModes = ["chase"];
  }

  // Attacks by the player make it (and its wingmen) hostile.
  damage(amount, cause = "vehicle", byPlayer = false) {
    const ok = super.damage(amount, cause, byPlayer);
    if (ok && this.alive) {
      this.provoked = HOSTILE_TIME;
      this.manager.enemyJets?.provoke(this);
    }
    return ok;
  }

  get cfg() {
    // Slightly slower than the player's jet at the same settings.
    const base = this.manager.config.jet || { maxSpeed: 220, accel: 1, turnRate: 1, stallSpeed: 42, assist: true };
    return { ...base, maxSpeed: Math.min(base.maxSpeed, 260) * 0.9, turnRate: 0.85, accel: base.accel, assist: true, aimAssist: true };
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
    const hostile = (this.hostile || this.provoked > 0) && !mgr.player.dead;
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
      // Pursuit with lead. It comes in high and drops toward the target as it
      // closes (so it never dives into the ground on the way).
      const speed = Math.max(60, this.speed);
      const lead = dist / (speed + 100);
      const lowTarget = P.pos.y < this.pos.y + 80;
      const lift = lowTarget ? clamp((dist - 140) * 0.3, 0, 180) : 0;
      const aim = _w.copy(P.pos).addScaledVector(P.vel, lead * 0.6);
      aim.y += lift;
      aim.sub(this.pos);
      const aimDist = aim.length();
      aim.divideScalar(aimDist || 1);
      const angle = _q2.copy(P.pos).sub(this.pos).normalize().angleTo(fwd); // to the target itself
      wantYaw = Math.atan2(-aim.x, -aim.z);
      wantPitch = Math.asin(clamp(aim.y, -1, 1));
      throttle = 1;
      ab = dist > 350;
      // Strafing runs: fire on the way in, then pull up and turn away before the target (or the ground) is too close.
      if (dist < 110 && lowTarget) {
        wantYaw += 1.1;
        wantPitch = 0.6;
      } else if (dist < 90 && angle > 0.5) {
        wantYaw += 1.2;
        wantPitch = 0.4;
      }
      if (lowTarget) wantPitch = Math.max(wantPitch, -clamp(0.3 + groundClear / 500, 0.3, 0.8));
      // Guns: bursts when the nose is on the target.
      ai.burstT -= dt;
      if (dist < 600 && angle < 0.07 && ai.burstT <= 0 && !this.jammed) {
        ai.burstLeft = 14 + Math.floor(Math.random() * 10);
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

    // Terrain: pull up before the ground (looking ahead along the flight path).
    if (groundClear < 45 + this.speed * 0.3 && this.vel.y < 30) {
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

  // The enemy aims at the player, not at UFOs.
  _assistDir(from, fwd, speed) {
    const P = this._player();
    const d = _w.copy(P.pos).sub(from);
    const dist = d.length();
    if (dist < 20 || dist > 1100) return fwd.clone();
    const ang = d.clone().normalize().angleTo(fwd);
    if (ang > 0.12) return fwd.clone();
    const target = P.pos.clone().addScaledVector(P.vel, dist / speed);
    const aim = target.sub(from).normalize();
    return fwd.clone().lerp(aim, 0.7).normalize();
  }

  onDestroyed(cause) {
    super.onDestroyed(cause);
    this.manager.enemyJets?.onDown(this, cause);
  }
}

VehicleManager.register("enemyjet", EnemyJet);

// Spawns and removes the patrols; decides when they turn hostile.
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
    vehicles.enemyJets = this;
  }

  get jets() {
    return this.vehicles.vehicles.filter((v) => v.isEnemyJet && v.alive);
  }

  // Someone attacked a jet: every jet turns on the player for a while.
  provoke() {
    for (const j of this.jets) j.provoked = Math.max(j.provoked, HOSTILE_TIME);
  }

  _hostileNow() {
    const u = this.ufos;
    return u.lastPlayerAttack !== undefined && u.time - u.lastPlayerAttack < HOSTILE_TIME;
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
    const yaw = opts.toward ? Math.atan2(-(p.x - x), -(p.z - z)) : Math.atan2(Math.sin(a), -Math.cos(a)) + (Math.random() - 0.5);
    const jet = this.vehicles.create("enemyjet", { pos: [x, y, z], yaw, airborne: true, speed: 110, throttle: 0.7 });
    if (jet && opts.hostile) {
      jet.provoked = HOSTILE_TIME;
      this.vehicles.onMessage?.("ENEMY FIGHTER SCRAMBLED! The aliens have an air force.");
    }
    return jet;
  }

  update(dt) {
    const veh = this.vehicles;
    if (!veh.enabled || !this.enabled) {
      for (const j of this.jets) veh.remove(j);
      return;
    }
    const jets = this.jets;
    const hostile = this._hostileNow();
    for (const j of jets) {
      j.hostile = hostile;
      // Far away for good: gone.
      if (j.pos.distanceTo(this.player.position) > 4200) veh.remove(j);
    }
    const max = Math.min(MAX_JETS, Math.round(this.config.count));
    if (jets.length > max) veh.remove(jets[0]);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 45 + Math.random() * 60;
      if (jets.length < max && !this.player.dead) this.spawn({});
    }
    // Attacking UFOs brings reinforcements at once, from the direction the player faces.
    this.reinforceT -= dt;
    if (hostile && jets.length < max && this.reinforceT <= 0 && !this.player.dead) {
      this.reinforceT = 70;
      this.spawn({ dist: 900, toward: true, hostile: true, angle: -this.player.yaw + Math.PI / 2 + (Math.random() - 0.5) * 2 });
    }
  }

  clear() {
    for (const j of this.jets) this.vehicles.remove(j);
  }
}
