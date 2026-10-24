// (Round 13) The ground war's other side: the aliens' hijacked tanks, AA
// vehicles and missile launchers, and the manager that sets them out
// (GroundWar). Missions worlds only (the mission chain sends them; after
// the tank battle, platoons now and then on their own), and the parked
// vehicles of the military bases (sites.js) for the players to take.
//
// Enemy tanks (EnemyTank) look for a player with a clear line of sight
// (smoke screens block it), drive to a fighting range, stop, swing the
// turret round (at the gun's own slow rate: you see it coming), let the aim
// settle a moment and fire an HE shell (they lead a moving target only in
// part and scatter a little: keep moving). They fire at players on foot and
// in vehicles on the ground, never at aircraft. They follow a convoy's road
// when they are in one.
//
// AA vehicles (AAVehicle) search the sky with their radar (it spins) and
// track the players' aircraft: bursts of tracer flak from the twin cannons
// (with black flak bursts round the target) and, once they have tracked an
// aircraft for a few seconds, SAMs: guided missiles with smoke trails that
// the jets' missile warning sees and their flares fool (the same rules as
// an enemy fighter's missiles: vehicle-jet.js).
//
// Balance: their shells hurt a player on foot about as a grenade does at
// the edge of its blast (a direct hit nearly kills, a near miss stings); a
// tank takes 3-4 direct hits from a tank's gun, about two missiles; the
// fire is telegraphed (the turret turns, a settle, the flash); caps on how
// many there are (weak PCs: ten at most, the far ones idle).
//
// Online: the host's AI; the units are shared vehicles (net/vehicles.js:
// guests see puppets, their hits are sent to the host), their shots go to
// everyone (net/ground.js), the SAMs travel with the projectiles (net/fx.js:
// a guest's jet warns of them, its flares count on the host). A guest's
// kill comes back to them ("gkill": their stats, the callout).
import * as THREE from "three";
import { VehicleManager } from "./vehicles.js";
import { Tank, GroundVehicle, TANK_TYPES, shellsOf, smokeBlocks } from "./vehicle-tank.js";
import { Tel, BallisticSystem } from "./ballistic.js";
import { missileGeometry } from "./vehicle-jet.js";
import { isPlayerCause } from "./damage.js";
import { effectsQuality } from "./effects.js";
import { SEA_LEVEL } from "./constants.js";
import { IS_WET } from "./blocks.js";

const MAX_UNITS = 10; // enemy ground units at once
const FAR = 1600; // beyond this from every player an ambient unit goes
const IDLE_FAR = 700; // beyond this from every player a unit idles (no AI)
const ENGAGE = 330; // a tank fights out to this range
const SIGHT = 420; // and sees a player this far
const AA_RANGE = 1150; // the AA's radar
const FLAK_RANGE = 780;
const SAM_RANGE = [140, 1500];
const SAM_SPEED = 330;
const SAM_TURN = 2.0;
const SAM_DAMAGE = 62;
const SAM_FUSE = 3;
const YARD_NEAR = 520; // a base's vehicles are set out within this of a player
const YARD_FAR = 850;

// Enemy shells: lighter than the players' (fair on foot), but they look the part.
export const ENEMY_SHELL = { damage: 38, ufoDamage: 0, radius: 2, look: 7.5 };
// The AA vehicle's numbers.
export const AA_SPEC = { id: "aa", name: "AA vehicle", paint: "enemy", maxHealth: 280, speed: 9, reverse: 4, accel: 3, brake: 10, turn: 0.6, traverse: 1.6, elev: 1.2, minPitch: -0.05, maxPitch: 1.35, reload: 0, shellSpeed: 380, mass: 4 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}

// Where a foe is (its body's middle, or its vehicle) and how it moves.
function foePos(f, out) {
  const v = f.vehicle;
  if (v) return out.copy(v.pos).setY(v.pos.y + (v.isGround ? 1.4 : 0));
  return out.set(f.position.x, f.position.y + 1, f.position.z);
}
function foeVel(f) {
  return f.vehicle ? f.vehicle.vel : f.velocity;
}
// Is the foe flying (an aircraft off the ground)?
function airborne(f, mgr) {
  const v = f.vehicle;
  if (!v || v.isGround) return false;
  const g = mgr.groundBelow(v.pos.x, v.pos.y, v.pos.z);
  return v.pos.y - g > 12 && !v.onGround;
}

// What every enemy unit shares: who hit it (online: which player), kills.
const EnemyMixin = (Base) =>
  class extends Base {
    _enemyInit() {
      this.isEnemyGround = true;
      this.enemy = true;
      this.unusable = true;
      this.transient = true;
      this.keep = true;
      this.npc = true;
      this.alert = 0;
    }
    damage(amount, cause = "vehicle", byPlayer = false) {
      const mine = isPlayerCause(cause);
      // (A player's hit: whose. The host's own: no attacker set; a guest's: net/vehicles.js set it.)
      if (mine && cause !== "pvp" && this.alive) {
        this.lastHitByPid = this.manager.currentAttacker ?? this.manager.localPid ?? 1;
        this.lastHitByT = performance.now();
      } else if (mine && this.alive) this.lastHitByT = performance.now();
      const ok = super.damage(amount, cause, byPlayer);
      if (ok && mine) this.alert = 30; // (shot at: it looks for whoever did it)
      return ok;
    }
    // The player whose kill it is (0: nobody's).
    get killer() {
      return this.lastHitByPid && performance.now() - (this.lastHitByT ?? -1e9) < 30000 ? this.lastHitByPid : 0;
    }
  };

// ---------- The enemy tank ----------

export class EnemyTank extends EnemyMixin(Tank) {
  constructor(manager, data = {}) {
    super(manager, { ...data, paint: data.paint || "enemy" }, { type: "enemytank", name: `Hijacked ${TANK_TYPES[data.kind]?.name.toLowerCase() || "tank"}` });
    this._enemyInit();
    this.cameraModes = ["chase"];
    this.ai = { foe: null, pickT: rand(0, 1.5), settleT: 0, wp: null, wpT: 0, seenT: 0, reload: rand(3, 6), warnT: 0 };
    this.home = this.pos.clone();
    this.route = Array.isArray(data.route) ? data.route.map((p) => new THREE.Vector3(p[0], p[1] ?? 0, p[2])) : null;
    this.routeI = 0;
  }

  serialize() {
    return { ...super.serialize(), type: "enemytank" };
  }

  _foes() {
    return this.manager.ground?.foes() || [this.manager.player];
  }

  // Can it see p from its turret (the ground, smoke)?
  _sees(p) {
    const mgr = this.manager;
    const eye = _u.copy(this.pos).setY(this.pos.y + this.model.height);
    const d = _w.copy(p).sub(eye);
    const len = d.length();
    if (len < 1) return true;
    d.divideScalar(len);
    const h = mgr.world.raycast(eye, d, len - 1.5, { solidOnly: true });
    if (h) return false;
    return !smokeBlocks(eye, p);
  }

  _pick() {
    const mgr = this.manager;
    let best = null;
    let bd = this.alert > 0 ? SIGHT * 1.4 : SIGHT;
    for (const f of this._foes()) {
      if (f.dead || f.creative || airborne(f, mgr)) continue;
      const p = foePos(f, _p);
      const d = p.distanceTo(this.pos);
      if (d < bd && this._sees(p)) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  _control(dt) {
    const ai = this.ai;
    const mgr = this.manager;
    this.alert = Math.max(0, this.alert - dt);
    ai.pickT -= dt;
    if (ai.pickT <= 0) {
      ai.pickT = 1.2 + Math.random() * 0.6;
      const f = this._pick();
      if (f) {
        ai.foe = f;
        ai.seenT = 6;
      }
    }
    ai.seenT -= dt;
    const foe = ai.foe && !ai.foe.dead && !ai.foe.gone && ai.seenT > 0 ? ai.foe : null;
    if (!foe) ai.foe = null;
    let throttle = 0;
    let steer = 0;
    const steerTo = (x, z, speed = 0.7) => {
      const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
      const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      steer = clamp(d * 2.2, -1, 1);
      throttle = Math.abs(d) > 1.2 ? 0.15 : speed;
    };
    const fp = foe ? foePos(foe, _p).clone() : null;
    const dist = fp ? fp.distanceTo(this.pos) : Infinity;
    if (this.route) {
      // A convoy: along its road, whatever happens (it fires on the move).
      const wp = this.route[this.routeI];
      if (wp) {
        steerTo(wp.x, wp.z, 0.55);
        if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 12) this.routeI++;
      } else this.routeDone = true;
    } else if (foe) {
      // Closer to the fight, then a halt to shoot from; never right on top of them.
      if (dist > ENGAGE * 0.75) steerTo(fp.x, fp.z, 0.8);
      else if (dist < 45) {
        steerTo(2 * this.pos.x - fp.x, 2 * this.pos.z - fp.z, 0.5);
      }
    } else {
      // Patrol round its home.
      ai.wpT -= dt;
      if (!ai.wp || ai.wpT <= 0 || Math.hypot(ai.wp.x - this.pos.x, ai.wp.z - this.pos.z) < 8) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(15, 60);
        ai.wp = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        ai.wpT = rand(15, 30);
      }
      steerTo(ai.wp.x, ai.wp.z, 0.4);
    }
    this._drive(dt, throttle, steer, throttle === 0);
    if (Math.abs(this.speed) < 0.3 && throttle !== 0) ai.stuckT = (ai.stuckT || 0) + dt;
    else ai.stuckT = 0;
    if (ai.stuckT > 4) {
      // (Stuck on something: a new way round.)
      ai.wp = null;
      ai.stuckT = 0;
      this.yaw += rand(-1.2, 1.2);
    }
    // The gun.
    ai.reload -= dt;
    if (foe && dist < ENGAGE) {
      const lead = foeVel(foe);
      const tof = dist / this.spec.shellSpeed;
      const aim = _w.copy(fp).addScaledVector(lead, tof * 0.55);
      const want = this._aimAt(aim, new THREE.Vector3());
      const err = this._traverse(dt, want);
      // The local player gets a warning when a turret comes onto them.
      if (foe === mgr.player && err < 0.25 && ai.warnT <= 0) {
        ai.warnT = 25;
        mgr.onMessage?.("ENEMY TANK has you in its sights: keep moving!");
      }
      ai.warnT -= dt;
      if (err < 0.035 && ai.reload <= 0) {
        ai.settleT += dt;
        // (The aim settles: a moment you can see the gun come to rest on you.)
        if (ai.settleT > 0.9 && Math.abs(this.speed) < 3) {
          ai.settleT = 0;
          ai.reload = rand(7, 9.5);
          const spread = 0.028;
          want.x += rand(-spread, spread);
          want.y += rand(-spread, spread) * 0.6;
          want.z += rand(-spread, spread);
          this.fireGun({ dir: want.normalize(), cause: "enemyshell", damage: ENEMY_SHELL.damage, ufoDamage: 0, radius: ENEMY_SHELL.radius, look: ENEMY_SHELL.look, player: false, foes: () => this._foes(), reload: 0 });
        }
      } else ai.settleT = Math.max(0, ai.settleT - dt);
    } else {
      // Nothing to shoot: the turret over the front again, slowly.
      this._traverse(dt, this.forward(_v).setY(0.02).normalize());
    }
  }

  hud() {
    return { title: this.name, rows: [], health: this.health / this.maxHealth };
  }
}

// ---------- The AA vehicle ----------

let _samGeo = null;
let _samMat = null;

export class AAVehicle extends EnemyMixin(GroundVehicle) {
  constructor(manager, data = {}) {
    super(manager, { ...data, paint: data.paint || "enemy" }, { type: "aa", name: "Hijacked AA vehicle", spec: AA_SPEC, kind: "aa", model: "aa", maxHealth: AA_SPEC.maxHealth });
    this._enemyInit();
    this.missiles = [];
    this.ai = { foe: null, pickT: 0, track: 0, burstT: rand(1, 3), burstLeft: 0, gunI: 0, samT: rand(4, 7), sams: 4, samReload: 0, warnT: 0 };
    this.home = this.pos.clone();
    this.route = Array.isArray(data.route) ? data.route.map((p) => new THREE.Vector3(p[0], p[1] ?? 0, p[2])) : null;
    this.routeI = 0;
  }

  serialize() {
    return { ...super.serialize(), type: "aa" };
  }

  _foes() {
    return this.manager.ground?.foes() || [this.manager.player];
  }

  _control(dt) {
    const mgr = this.manager;
    const ai = this.ai;
    ai.pickT -= dt;
    if (ai.pickT <= 0) {
      ai.pickT = 1;
      let best = null;
      let bd = AA_RANGE;
      for (const f of this._foes()) {
        if (f.dead || !airborne(f, mgr)) continue;
        const p = foePos(f, _p);
        const d = p.distanceTo(this.pos);
        if (d < bd && !mgr.world.raycast(_u.copy(this.pos).setY(this.pos.y + 3.5), _w.copy(p).sub(_u).normalize(), d - 4, { solidOnly: true })) {
          bd = d;
          best = f;
        }
      }
      if (best !== ai.foe) ai.track = 0;
      ai.foe = best;
    }
    // On the move along a road (a convoy's), else parked where it is.
    if (this.route) {
      const wp = this.route[this.routeI];
      if (wp) {
        const want = Math.atan2(-(wp.x - this.pos.x), -(wp.z - this.pos.z));
        const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
        this._drive(dt, Math.abs(d) > 1.2 ? 0.15 : 0.55, clamp(d * 2.2, -1, 1));
        if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 12) this.routeI++;
      } else {
        this.routeDone = true;
        this._drive(dt, 0, 0, true);
      }
    } else this._drive(dt, 0, 0, true);
    const foe = ai.foe && !ai.foe.dead && !ai.foe.gone ? ai.foe : null;
    ai.samReload -= dt;
    if (ai.samReload <= 0 && ai.sams <= 0) ai.sams = 4;
    if (foe) {
      const p = foePos(foe, _p).clone();
      const d = p.distanceTo(this.pos);
      const tof = d / AA_SPEC.shellSpeed;
      const aim = _w.copy(p).addScaledVector(foeVel(foe), tof * 0.85).sub(this.muzzleWorld(_u)).normalize();
      const err = this._traverse(dt, aim);
      ai.track += dt;
      // Flak: bursts of tracers, black bursts round the target.
      ai.burstT -= dt;
      if (err < 0.08 && d < FLAK_RANGE && ai.burstT <= 0 && ai.burstLeft <= 0) {
        ai.burstLeft = 9;
        ai.burstT = rand(2.2, 3.2);
        this._flakPuffs(p, foeVel(foe), d);
      }
      if (ai.burstLeft > 0) {
        ai.gunT = (ai.gunT || 0) - dt;
        while (ai.gunT <= 0 && ai.burstLeft > 0) {
          ai.gunT += 0.085;
          ai.burstLeft--;
          this._flak(aim);
        }
      }
      // SAMs: after a few seconds' track, one at a time.
      ai.samT -= dt;
      if (ai.track > 3 && ai.samT <= 0 && ai.sams > 0 && d > SAM_RANGE[0] && d < SAM_RANGE[1] && this.missiles.length < 2) {
        ai.samT = rand(10, 14);
        ai.sams--;
        if (ai.sams <= 0) ai.samReload = 30;
        this._launchSam(foe);
      }
    } else {
      ai.track = 0;
      // The guns at rest, up at the sky.
      this._traverse(dt, this.forward(_v).setY(0.8).normalize());
    }
    this._updateSams(dt);
  }

  // One flak round from the cannon on alternate sides.
  _flak(dir) {
    const mgr = this.manager;
    const guns = this.model.guns || [];
    const g = guns[this.ai.gunI++ % Math.max(1, guns.length)];
    this.root.updateMatrixWorld(true);
    const from = g ? g.getWorldPosition(new THREE.Vector3()) : this.muzzleWorld(new THREE.Vector3());
    const d = dir.clone();
    d.x += rand(-0.012, 0.012);
    d.y += rand(-0.012, 0.012);
    d.z += rand(-0.012, 0.012);
    d.normalize();
    mgr.lasers?.fire({ from, dir: d, color: _flakC, speed: AA_SPEC.shellSpeed, damage: 4, owner: "enemyjet", source: this, range: FLAK_RANGE + 60, radius: 0.08, length: 4, sound: false, tracer: true, cause: "flak", scorch: false });
    this.recoil = 0.6;
    const fx = mgr.effects;
    fx.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.06, size0: 1.4, size1: 0.4, color0: _hotC, alpha: 0.9 });
    if (this.ai.gunI % 3 === 0) fx.smoke.spawn({ x: from.x, y: from.y, z: from.z, vx: d.x * 3, vy: d.y * 3 + 0.5, vz: d.z * 3, life: 1.5, size0: 0.5, size1: 2, color0: _greyC, alpha: 0.35, drag: 1.5 });
    if (this.ai.gunI % 2 === 0) mgr.audio?.playDistant?.(from.distanceTo(fx.listener), () => mgr.audio.playMachineGun?.());
  }

  // The black flak bursts near the target (also on every other screen: net/ground.js).
  _flakPuffs(p, vel, d) {
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const t = (i + 1) * 0.25;
      pts.push(p.clone().addScaledVector(vel, t).add(_v.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).multiplyScalar(rand(9, 22))));
    }
    flakBursts(this.manager, pts, d / AA_SPEC.shellSpeed);
    this.manager.onGroundFire?.(this, "flak", pts[0], null, pts);
  }

  _launchSam(foe) {
    const mgr = this.manager;
    const tubes = this.model.sams || [];
    this.root.updateMatrixWorld(true);
    const t = tubes[(this.ai.sams + 4) % Math.max(1, tubes.length)];
    const from = t ? t.getWorldPosition(new THREE.Vector3()) : this.pos.clone().setY(this.pos.y + 3);
    const dir = this.gunDir(new THREE.Vector3());
    const mesh = new THREE.Mesh(_samGeo || (_samGeo = missileGeometry()), _samMat || (_samMat = new THREE.MeshLambertMaterial({ vertexColors: true })));
    mgr.scene.add(mesh);
    const target = { kind: "player", ref: foe };
    const m = { pos: from, vel: dir.clone().multiplyScalar(40), dir: dir.clone(), speed: 40, target, age: 0, mesh, trail: 0, hostile: true, launcher: this, decoyed: false, sam: true };
    this.missiles.push(m);
    // The launch: a burst of smoke at the tube, the roar.
    const fx = mgr.effects;
    for (let i = 0; i < Math.round(10 * Math.max(0.4, effectsQuality.scale)); i++) fx.trail.spawn({ x: from.x, y: from.y, z: from.z, vx: rand(-3, 3) - dir.x * 4, vy: rand(-1, 2), vz: rand(-3, 3) - dir.z * 4, life: rand(5, 8), size0: 1.2, size1: 5, color0: _whiteC, alpha: 0.7, drag: 1.5 });
    mgr.audio?.playDistant?.(from.distanceTo(fx.listener), () => mgr.audio.playRocketLaunch?.());
    if (foe === mgr.player) mgr.onMessage?.("SAM LAUNCH! Flares (C), break hard!");
    return m;
  }

  // The SAMs in flight: guided as an enemy fighter's missile (lead pursuit,
  // a turn limit, flares fool most, a hard roll at the last moment shakes it).
  _updateSams(dt) {
    const mgr = this.manager;
    const fx = mgr.effects;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      m.speed = Math.min(SAM_SPEED, m.speed + 220 * dt);
      const t = m.target;
      let tp = null;
      let tv = null;
      let tveh = null;
      if (t?.kind === "decoy") {
        if (t.ref.life <= 0) m.target = null;
        else {
          tp = _p.copy(t.ref.pos);
          tv = t.ref.vel;
        }
      } else if (t?.ref && !t.ref.dead) {
        tveh = t.ref.vehicle || null;
        tp = foePos(t.ref, _p);
        tv = foeVel(t.ref);
      }
      if (t && t.kind !== "decoy" && m.age > 0.6) this._decoys(m);
      if (tp && m.age > 0.35) {
        const tgo = tp.distanceTo(m.pos) / Math.max(60, m.speed);
        const aim = _w.copy(tp).addScaledVector(tv || _v.set(0, 0, 0), tgo).sub(m.pos).normalize();
        if (tveh?.tryRollEvade?.(m) && !m.evaded) {
          m.evaded = true;
          m.target = null;
        } else {
          const ang = m.dir.angleTo(aim);
          const max = SAM_TURN * dt;
          if (ang > 1e-4) m.dir.lerp(aim, Math.min(1, max / ang)).normalize();
        }
      }
      m.vel.copy(m.dir).multiplyScalar(m.speed);
      const step = m.speed * dt;
      let boom = null;
      let hitVeh = null;
      // The fuse: near its target's airframe (or the body).
      if (tp && t?.kind !== "decoy") {
        const dd = tveh ? tveh.hullDistance(m.pos, 50) : tp.distanceTo(m.pos);
        if (dd < SAM_FUSE + step * 0.5) {
          boom = m.pos.clone();
          hitVeh = tveh;
        }
      }
      if (!boom && t?.kind === "decoy" && tp && tp.distanceTo(m.pos) < 4) boom = m.pos.clone();
      if (!boom) {
        const h = mgr.world.raycast(m.pos, m.dir, step, { solidOnly: true });
        if (h && m.age > 0.4) boom = m.pos.clone().addScaledVector(m.dir, Math.max(0, h.distance - 0.4));
      }
      if (boom || m.age > 13) {
        mgr.scene.remove(m.mesh);
        m.dead = true;
        this.missiles.splice(i, 1);
        if (boom) {
          if (hitVeh?.alive) hitVeh.damage(SAM_DAMAGE, "sam");
          fx.explode(boom, { radius: 3.5, source: "sam", visual: 6, carve: !!hitVeh === false && boom.y < mgr.groundBelow(boom.x, boom.y + 2, boom.z) + 2 });
        }
        continue;
      }
      m.pos.addScaledVector(m.dir, step);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(_w.set(0, 0, -1), m.dir);
      m.trail += step;
      const spacing = 2.4 / Math.max(0.35, effectsQuality.scale);
      while (m.trail > spacing) {
        m.trail -= spacing;
        const b = _u.copy(m.pos).addScaledVector(m.dir, -m.trail - 1);
        fx.trail.spawn({ x: b.x, y: b.y, z: b.z, vx: rand(-0.3, 0.3), vy: 0.2, vz: rand(-0.3, 0.3), life: rand(7, 10), size0: 0.7, size1: 3.6, color0: _whiteC, color1: _white2C, alpha: 0.7, drag: 0.6, hold: 0.3 });
      }
      fx.glow.spawn({ x: m.pos.x - m.dir.x * 1.6, y: m.pos.y - m.dir.y * 1.6, z: m.pos.z - m.dir.z * 1.6, life: 0.06, size0: 1.6, size1: 0.5, color0: _hotC, alpha: 0.9 });
    }
  }

  // Flares: a SAM after the target's aircraft turns on the nearest of its flares.
  _decoys(m) {
    if (m.decoyed) return;
    const t = m.target;
    const owner = t.ref.vehicle || t.ref;
    const list = this.manager.lasers?.decoys || [];
    let best = null;
    let bd = 650;
    for (const d of list) {
      if (d.life <= 0 || d.owner !== owner) continue;
      const dd = d.pos.distanceTo(m.pos);
      if (dd < bd && _w.copy(d.pos).sub(m.pos).normalize().angleTo(m.dir) < 1.1) {
        bd = dd;
        best = d;
      }
    }
    if (best) {
      m.decoyed = true;
      if (Math.random() < 0.85) m.target = { kind: "decoy", ref: best, was: t };
    }
  }

  onDestroyed(cause) {
    for (const m of this.missiles) this.manager.scene.remove(m.mesh);
    this.missiles.length = 0;
    super.onDestroyed(cause);
  }

  dispose() {
    for (const m of this.missiles) this.manager.scene.remove(m.mesh);
    super.dispose();
  }

  hud() {
    return { title: this.name, rows: [], health: this.health / this.maxHealth };
  }
}
const _flakC = new THREE.Color(3, 1.6, 0.5);
const _hotC = new THREE.Color(5, 3.4, 1.4);
const _greyC = new THREE.Color(0.5, 0.48, 0.46);
const _whiteC = new THREE.Color(0.88, 0.88, 0.86);
const _white2C = new THREE.Color(0.95, 0.95, 0.94);

// Flak bursts: a flash and a black puff at each point, `delay` seconds on.
export function flakBursts(mgr, pts, delay = 0.5) {
  const fx = mgr.effects;
  const black = _flakBlack;
  pts.forEach((p, i) => {
    fx._after?.(delay + i * 0.12, () => {
      fx.glow.spawn({ x: p.x, y: p.y, z: p.z, life: 0.12, size0: 4, size1: 1.5, color0: _hotC, alpha: 0.9 });
      for (let k = 0; k < 5; k++) fx.smoke.spawn({ x: p.x + rand(-1, 1), y: p.y + rand(-1, 1), z: p.z + rand(-1, 1), vx: rand(-2, 2), vy: rand(-0.5, 1), vz: rand(-2, 2), life: rand(3, 5), size0: 1.5, size1: rand(4.5, 6.5), color0: black, color1: _flakGrey, alpha: 0.85, drag: 1.4, hold: 0.3 });
      const ears = fx.listener;
      const d = ears ? p.distanceTo(ears) : 200;
      if (d < 220) mgr.audio?.playExplosion?.(d, 0.2);
    });
  });
}
const _flakBlack = new THREE.Color(0.05, 0.05, 0.05);
const _flakGrey = new THREE.Color(0.2, 0.2, 0.2);

// An enemy launcher (the TEL, in the aliens' charcoal).
export class EnemyTel extends EnemyMixin(Tel) {
  constructor(manager, data = {}) {
    super(manager, { ...data, enemy: true, paint: data.paint || "enemy" });
    this._enemyInit();
    this.type = "enemytel";
    this.reloadTime = data.reloadTime ?? 80;
  }
  serialize() {
    return { ...super.serialize(), type: "enemytel", enemy: true };
  }
  hud() {
    return { title: this.name, rows: [], health: this.health / this.maxHealth };
  }
}

VehicleManager.register("enemytank", EnemyTank);
VehicleManager.register("aa", AAVehicle);
VehicleManager.register("enemytel", EnemyTel);

// ---------- The manager ----------

// The stats a unit's destruction counts toward (progression.js labels them).
function statsOf(u) {
  const out = ["groundDown"];
  if (u.type === "enemytank") out.push("tanksDown");
  if (u.type === "aa") out.push("aaDown");
  if (u.type === "enemytel") out.push("telsDown");
  if (u.convoy) out.push("convoyDown");
  if (u.baseDefense) out.push("baseDefensesDown");
  return out;
}

export class GroundWar {
  constructor({ vehicles, world, player, effects, audio, scene, sites = null, crates = null, stats = null, progress = null, toast = null }) {
    this.vehicles = vehicles;
    this.world = world;
    this.player = player;
    this.effects = effects;
    this.audio = audio;
    this.scene = scene;
    this.sites = sites;
    this.crates = crates;
    this.stats = stats;
    this.progress = progress;
    this.toast = toast;
    this.enabled = true;
    this.puppets = false; // (a guest: the host's units come as puppets)
    this.targets = null; // () => [player-like] (online, the host: every player)
    this.voice = null; // the pilot's voice (js/voice.js: say(key))
    this.ambientAllowed = () => false; // (set by installGround: the chain's later acts)
    this.yardAllowed = () => true;
    this.onDown = []; // listeners (unit, { mine, pid }) (the mission director)
    this.onRemoteKill = null; // (pid, unit): a guest's kill (net/ground.js)
    this.downCount = 0;
    this.ambientT = rand(150, 260);
    this.yard = new Map(); // parkKey -> vehicle (the bases' parked vehicles here)
    this._yardT = 0;
    this._farT = 0;
    this.shells = shellsOf(vehicles);
    this.shells.driven = true;
    this.ballistics = new BallisticSystem({ scene, world, effects, audio, vehicles });
    vehicles.ground = this;
    vehicles.onGroundDown = (u, cause) => this._down(u, cause);
  }

  // Every enemy unit here (not puppets).
  get units() {
    return this.vehicles.vehicles.filter((v) => v.isEnemyGround && v.alive && !v.puppet);
  }

  // The players the units fight (alive).
  foes() {
    const list = this.targets ? this.targets() : [this.player];
    // (On Peaceful the aliens' machines leave this player be: mobDamageScale 0.)
    return list.filter((t) => !t.dead && !(t === this.player && t.mobDamageScale === 0));
  }

  _near(p, r) {
    for (const f of this.foes()) if ((f.vehicle ? f.vehicle.pos : f.position).distanceTo(p) < r) return true;
    return false;
  }

  // A spot on dry, fairly flat land near (x, z): [x, y, z] or null.
  // (The loaded ground where there is some (built on, levelled), else the
  // terrain's height map; flat first, then any dry spot, a wider search last.)
  landAt(x, z, spread = 30) {
    const w = this.world;
    const T = w.terrain;
    const height = (px, pz) => (w.getChunk(px >> 4, pz >> 4) ? this.vehicles.groundBelow(px + 0.5, 300, pz + 0.5) - 1 : T ? T.heightAt(px, pz) : w.heightAt(px, pz));
    const wet = (px, pz, h) => (w.getChunk(px >> 4, pz >> 4) ? !!IS_WET[w.getBlock(px, h, pz)] : h <= SEA_LEVEL + 1);
    for (let k = 0; k < 60; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = k ? Math.random() * spread * (k < 30 ? 1 : 2.5) : 0;
      const px = Math.floor(x + Math.cos(a) * r);
      const pz = Math.floor(z + Math.sin(a) * r);
      const h = height(px, pz);
      if (wet(px, pz, h)) continue;
      const steep = k < 40 ? 2 : 5;
      if ([[4, 0], [-4, 0], [0, 4], [0, -4]].some(([dx, dz]) => Math.abs(height(px + dx, pz + dz) - h) > steep)) continue;
      return [px + 0.5, h + 1, pz + 0.5];
    }
    return null;
  }

  _spawn(type, at, yaw, data = {}) {
    if (this.units.length >= MAX_UNITS && !data.force) return null;
    const v = this.vehicles.create(type, { pos: at, yaw, ...data });
    if (!v) return null;
    v.settle?.(true);
    return v;
  }

  spawnTank(at, yaw = 0, data = {}) {
    return this._spawn("enemytank", at, yaw, { kind: data.kind || (Math.random() < 0.35 ? "tiger" : "mbt"), ...data });
  }
  spawnAA(at, yaw = 0, data = {}) {
    return this._spawn("aa", at, yaw, data);
  }
  spawnTel(at, yaw = 0, data = {}) {
    return this._spawn("enemytel", at, yaw, data);
  }

  // A platoon (n tanks, an AA vehicle with it when aa) round a point, facing `face`.
  spawnPlatoon(center, n = 3, { aa = false, face = null, tag = null, tiger = 0.35, first = null } = {}) {
    const out = [];
    const yaw = face ? Math.atan2(-(face.x - center.x), -(face.z - center.z)) : Math.random() * Math.PI * 2;
    for (let i = 0; i < n + (aa ? 1 : 0); i++) {
      const side = (i - (n - 1) / 2) * 14;
      const x = center.x + Math.cos(yaw) * side + (Math.random() - 0.5) * 6;
      const z = center.z - Math.sin(yaw) * side + (Math.random() - 0.5) * 6;
      const at = this.landAt(x, z, 12);
      if (!at) continue;
      const v = i >= n ? this.spawnAA(at, yaw, { force: true }) : this.spawnTank(at, yaw, { kind: i === 0 && first ? first : Math.random() < tiger ? "tiger" : "mbt", force: true });
      if (v) {
        if (tag) v[tag] = true;
        out.push(v);
      }
    }
    return out;
  }

  // A convoy along a road from `from` to `to` (tanks, launchers on trucks, an AA vehicle).
  spawnConvoy(from, to, { n = 5, tag = "convoy" } = {}) {
    const out = [];
    const route = [];
    const L = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(2, Math.round(L / 60));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = from.x + (to.x - from.x) * k + Math.sin(k * 7) * 18;
      const z = from.z + (to.z - from.z) * k + Math.cos(k * 5) * 18;
      route.push([x, 0, z]);
    }
    const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    const kinds = ["enemytank", "enemytel", "aa", "enemytel", "enemytank", "enemytel", "enemytank"];
    for (let i = 0; i < n; i++) {
      const back = i * 18;
      const at = this.landAt(from.x + Math.sin(yaw) * back, from.z + Math.cos(yaw) * back, 6);
      if (!at) continue;
      const type = kinds[i % kinds.length];
      const v = this._spawn(type, at, yaw, { route, kind: "mbt", force: true });
      if (v) {
        v[tag] = true;
        out.push(v);
      }
    }
    return out;
  }

  // A unit is destroyed: who did it, the stats, a crate, the callout.
  _down(u, cause) {
    if (!u.isEnemyGround) {
      // (A player's own tank lost: its wreck burns, nothing else to count.)
      return;
    }
    if (u.puppet) return;
    this.downCount++;
    const pid = u.killer;
    const localPid = this.vehicles.localPid ?? 1;
    const mine = pid === localPid || (pid && !this.targets);
    const anyone = !!pid;
    if (anyone && this.stats) for (const k of statsOf(u)) (mine ? this.stats.add(k) : this.stats.addWorld(k));
    if (mine) {
      const what = u.type === "enemytel" ? "LAUNCHER DESTROYED!" : u.type === "aa" ? "AA VEHICLE DESTROYED!" : "TANK DESTROYED!";
      this.toast?.(what, 2.5);
      this.say(u.type === "enemytel" ? "target" : "tank");
    } else if (anyone) this.onRemoteKill?.(pid, u);
    // Its loot: a supply crate thrown clear, sometimes (always from a launcher).
    if (anyone && this.crates?.enabled && Math.random() < (u.type === "enemytel" ? 1 : u.type === "aa" ? 0.5 : 0.45)) {
      this.crates.drop({ center: u.pos, dist: 6, at: u.pos.clone() });
    }
    for (const fn of this.onDown) fn(u, { mine, pid });
  }

  say(key) {
    try {
      this.voice?.say?.(key);
    } catch {}
  }

  // The bases' parked vehicles: set out near a player, put away far from all.
  _yardUpkeep() {
    const sites = this.sites;
    if (!sites?.yardSpots) return;
    const allowed = this.yardAllowed();
    const centers = this.foes().map((f) => (f.vehicle ? f.vehicle.pos : f.position));
    if (!centers.length) centers.push(this.player.position);
    const taken = this.vehicles.airportsTaken;
    const want = new Set();
    if (allowed) {
      for (const c of centers) {
        for (const s of sites.within(c.x, c.z, YARD_NEAR + 300)) {
          for (const y of sites.yardSpots(s)) {
            if (Math.hypot(y.x - c.x, y.z - c.z) < YARD_NEAR) want.add(y.key);
            if (!want.has(y.key) || this.yard.has(y.key) || taken?.has(y.key)) continue;
            const type = y.kind === "tel" ? "tel" : "tank";
            const v = this.vehicles.create(type, { pos: [y.x, y.y, y.z], yaw: y.yaw, kind: y.kind === "tel" ? undefined : y.kind, paint: y.paint });
            if (!v) continue;
            v.parkedAt = s.id;
            v.parkKey = y.key;
            v.transient = true;
            v.keep = true;
            v.npc = true;
            if (type === "tel") v.unusable = true; // (in Creative a TEL is the palette's)
            v.settle(true);
            this.yard.set(y.key, v);
          }
        }
      }
    }
    for (const [key, v] of this.yard) {
      const gone = !this.vehicles.vehicles.includes(v) || !v.parkedAt;
      if (gone) {
        // (Boarded: no longer the base's; blown up: set out again when the players come back.)
        this.yard.delete(key);
        continue;
      }
      const far = centers.every((c) => Math.hypot(v.pos.x - c.x, v.pos.z - c.z) > YARD_FAR);
      if ((far || !allowed || taken?.has(key)) && !v.occupied) {
        this.vehicles.remove(v);
        this.yard.delete(key);
      }
    }
  }

  // Now and then (the chain's later acts, nothing else on): a platoon, or
  // an AA site if the players are flying, a few hundred blocks off.
  _ambient(dt) {
    if (this.puppets || !this.ambientAllowed()) return;
    const units = this.units;
    if (units.some((u) => u.ambient)) return;
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    this.ambientT = rand(200, 330);
    const foes = this.foes();
    if (!foes.length) return;
    const f = foes[Math.floor(Math.random() * foes.length)];
    const c = f.vehicle ? f.vehicle.pos : f.position;
    const a = Math.random() * Math.PI * 2;
    const R = rand(360, 520);
    const at = this.landAt(c.x + Math.cos(a) * R, c.z + Math.sin(a) * R, 60);
    if (!at) return;
    const flying = foes.some((q) => q.vehicle && !q.vehicle.isGround && !q.vehicle.onGround);
    const list = flying ? [this.spawnAA(new THREE.Vector3(...at), a)] : this.spawnPlatoon(new THREE.Vector3(at[0], at[1], at[2]), 2, { face: c });
    for (const u of list) if (u) u.ambient = true;
    if (list.length) {
      const dir = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][Math.round(((Math.atan2(Math.sin(a), Math.cos(a)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
      this.toast?.(flying ? `An enemy AA vehicle has set up to the ${dir}: watch for SAMs.` : `Hijacked tanks spotted to the ${dir}, heading your way!`, 5);
    }
  }

  update(dt) {
    const veh = this.vehicles;
    const off = !veh.enabled || !this.enabled;
    if (off) {
      for (const u of this.units) veh.remove(u);
      for (const [, v] of this.yard) if (!v.occupied) veh.remove(v);
      this.yard.clear();
    }
    this.shells.update(dt);
    this.ballistics.update(dt);
    if (off) return;
    this._yardT -= dt;
    if (this._yardT <= 0) {
      this._yardT = 1;
      this._yardUpkeep();
    }
    if (this.puppets) return;
    this._ambient(dt);
    // Far from everyone: an ambient unit goes; others idle (no AI: cheap).
    this._farT -= dt;
    if (this._farT <= 0) {
      this._farT = 1;
      for (const u of this.units) {
        const near = this._near(u.pos, IDLE_FAR);
        u.idle = !near;
        if (u.ambient && !this._near(u.pos, FAR)) veh.remove(u);
      }
    }
  }

  clear() {
    for (const u of this.units) this.vehicles.remove(u);
    this.ballistics.clear();
    this.shells.clear();
  }
}

// (Idle units: the update is skipped but for the wreck; patched in here so
// every unit kind gets it.)
for (const cls of [EnemyTank, AAVehicle, EnemyTel]) {
  const up = cls.prototype.update;
  cls.prototype.update = function (dt, input) {
    if (this.idle && this.alive && !this.busy) {
      this.hurtTime += dt;
      return;
    }
    up.call(this, dt, input);
  };
}

// Wires the ground war into the game (called once by main.js; returns the
// GroundWar). game: { scene, camera, world, player, vehicles, effects,
// audio, lasers, ufos, mobs, crates, stats, progress, missions, airports,
// toast, hud, mods, voice }. It runs right after the vehicles each frame.
export function installGround(game) {
  const veh = game.vehicles;
  if (veh.ground) return veh.ground;
  const war = new GroundWar({ vehicles: veh, world: game.world, player: game.player, effects: game.effects, audio: game.audio, scene: game.scene, sites: game.world?.terrain?.sites || game.sites, crates: game.crates, stats: game.stats, progress: game.progress, toast: game.toast });
  veh.camera = game.camera;
  veh.hitMarker = () => game.hud?.hitMarker?.();
  veh.airportsTaken = game.airports?.taken || null;
  war.voice = game.voice || null;
  const progress = game.progress;
  // (After the tank battle, in the mission chain: platoons and AA sites now and then.)
  war.ambientAllowed = () => !!progress?.enabled && !game.player.creative && (progress.reached?.("tank_battle") ?? false) && progress.isDone?.("tank_battle") !== false && game.mods?.enabled !== false;
  // (The bases' tanks: in Creative, or from the tank battle on.)
  war.yardAllowed = () => game.player.creative || !progress?.enabled || !!progress.reached?.("tank_battle");
  const update = veh.update.bind(veh);
  veh.update = (dt) => {
    update(dt);
    war.update(dt);
  };
  if (game.missions?.attachGround) game.missions.attachGround(war);
  return war;
}
