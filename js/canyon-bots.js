// (Round 16) The canyon run's enemy jets ("bots"): bandits that fly the
// canyon and fight. Optional (the canyon screen: None, Few, Some, Many).
//
// A bandit is an enemy fighter (js/enemy-jets.js EnemyJet: the same flight
// model, guns and flares) with an autopilot of its own for the canyon: it
// flies the course's line (CanyonCourse.safePoint: a point at each stretch
// it can fly through, round the arches, pillars, fins and asteroids), looks
// ahead along its path and turns away from the rock before it gets there,
// and keeps its distance from the others. Two kinds:
//   - "runners" fly the course the player's way, a little slower: catch one
//     up and shoot it; fly past it and it chases you and shoots back;
//   - "head-on" ones come the other way, guns blazing, and pass.
// They shoot with their cannon when the nose is on the player (and nothing
// is in between), weaker and less accurate on the easier difficulties.
// They never get a missile off (in a canyon a missile is a sure kill), but
// drop flares at the player's. The run (js/canyon.js) counts the kills.
import * as THREE from "three";
import { VehicleManager } from "./vehicles.js";
import { Jet } from "./vehicle-jet.js";
import { EnemyJet } from "./enemy-jets.js";
import { isPlayerCause } from "./damage.js";

// Per level (the menu's): how many at once, how soon another comes.
export const BOT_LEVELS = [
  { id: "none", name: "None", count: 0 },
  { id: "few", name: "Few", count: 2, gap: [9, 15] },
  { id: "some", name: "Some", count: 4, gap: [5, 9] },
  { id: "many", name: "Many", count: 6, gap: [3, 6] },
];
// Per difficulty: their guns (x the cannon's damage), the spread of their
// aim (radians), their health.
const SKILL = {
  easy: { gun: 0.22, spread: 0.045, hp: 45, burst: [5, 8] },
  normal: { gun: 0.32, spread: 0.03, hp: 55, burst: [7, 11] },
  hard: { gun: 0.42, spread: 0.02, hp: 65, burst: [9, 14] },
  insane: { gun: 0.5, spread: 0.014, hp: 70, burst: [10, 16] },
};
const AHEAD = [230, 320]; // blocks ahead of the player a bandit appears
const BEHIND_GONE = 280; // ... and how far behind it is let go
const FIRE_RANGE = 520;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const GUIDE_RATE = 1.1; // rad/s: the most the guiding hand bends a bandit's path

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export class CanyonBot extends EnemyJet {
  constructor(manager, data = {}) {
    // (flown for the other side from the start: a "hijacked" fighter, never neutral)
    super(manager, { ...data, hijacked: true });
    this.name = "Bandit";
    this.canyonBot = true;
    this.dirZ = data.dirZ === -1 ? -1 : 1;
    this.role = this.dirZ < 0 ? "headon" : "runner";
    this.skill = SKILL[data.skill] || SKILL.normal;
    this.maxHealth = this.health = this.skill.hp;
    this.run = data.run || null;
    this.flareCool = 0;
    this.avoidT = 0;
    this.stuckT = 0;
  }

  // (their own speed, by the throttle below: the patrols' edge isn't theirs)
  get cfg() {
    const base = this.manager.config.jet || { maxSpeed: 300, accel: 1, turnRate: 1, stallSpeed: 42, assist: true };
    if (this._cbBase !== base) {
      this._cbBase = base;
      this._cbCfg = { ...base, maxSpeed: Math.min(base.maxSpeed, 300), stallSpeed: base.stallSpeed ?? 42, turnRate: 1.15, accel: (base.accel ?? 1) * 1.3, assist: true, aimAssist: true };
    }
    return this._cbCfg;
  }

  _autopilot(dt, stick) {
    const run = this.run;
    const c = run?.course;
    if (!c) return super._autopilot(dt, stick);
    this.age += dt;
    this.flareT = Math.max(0, this.flareT - dt);
    this.flareCool = Math.max(0, this.flareCool - dt);
    const ai = this.ai;
    const pos = this.pos;
    const fwd = this.forward(_v);
    const speed = Math.max(40, this.speed);
    const pj = run.jet && run.jet.alive && run.state === "flying" ? run.jet : null;
    // ---- Where to: the course's line ahead ----
    // (Not too far: a far point drawn straight across a bend cuts its inside.)
    const look = clamp(speed * 0.7, 50, 130);
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let found = false;
    for (const f of [1, 0.6, 0.35]) {
      const z = pos.z + this.dirZ * look * f;
      const sp = c.safePoint(z);
      const xx = sp.x;
      if (c.tubeClear(pos.x, pos.y, pos.z, xx, sp.y, z, 9)) {
        tx = xx;
        ty = sp.y;
        tz = z;
        found = true;
        break;
      }
    }
    if (!found) {
      // (nothing straight ahead is clear: the safe point just ahead, hard)
      const sp = c.safePoint(pos.z + this.dirZ * 16);
      tx = sp.x;
      ty = sp.y;
      tz = pos.z + this.dirZ * 24;
    }
    if (!found) this.stuckT += dt;
    else this.stuckT = 0;
    // ---- The fight ----
    let attack = false;
    let dist = Infinity;
    let angle = Math.PI;
    if (pj) {
      const to = _w.copy(pj.pos).sub(pos);
      dist = to.length();
      angle = to.normalize().angleTo(fwd);
      // (a runner fights once the player is past it; a head-on one while it comes)
      const ahead = (pj.pos.z - pos.z) * this.dirZ > 0;
      if (ahead && dist < 650 && angle < 0.7) {
        const lead = dist / (speed + 700);
        const ax = pj.pos.x + pj.vel.x * lead;
        const ay = pj.pos.y + pj.vel.y * lead;
        const az = pj.pos.z + pj.vel.z * lead;
        // (only where it can fly: not through the rock to get the shot)
        if (c.tubeClear(pos.x, pos.y, pos.z, ax, ay, az, 5) && !c.solidAt(ax, ay, az)) {
          attack = true;
          tx = ax;
          ty = ay;
          tz = az;
        }
      }
    }
    // ---- The others: no flying into each other ----
    let steer = false;
    for (const o of run.bots?.list ?? []) {
      if (o === this || !o.alive) continue;
      const d = o.pos.distanceTo(pos);
      if (d < 45) {
        steer = true;
        tx += (pos.x - o.pos.x) * 0.6;
        ty += (pos.y - o.pos.y) * 0.6;
      }
    }
    // (and never into the player: a head-on one passes beside and above,
    // a runner keeps clear)
    const closing = pj ? (pj.pos.z - pos.z) * this.dirZ > -10 : false;
    if (pj && closing && dist < (this.role === "headon" ? 150 : 35)) {
      steer = true;
      attack = attack && dist > 60;
      const side = pos.x >= pj.pos.x ? 1 : -1;
      tx = pj.pos.x + side * 20;
      ty = pj.pos.y + 9;
      tz = pj.pos.z;
      if (c.solidAt(tx, ty, tz)) tx = pj.pos.x - side * 20;
    }
    // ---- The rock: where it will be in a moment, along its path ----
    this.avoidT = Math.max(0, this.avoidT - dt);
    for (const k of [0.3, 0.6, 1]) {
      const px = pos.x + this.vel.x * k;
      const py = pos.y + this.vel.y * k;
      const pz = pos.z + this.vel.z * k;
      if (c.solidAt(px, py, pz) || c.solidAt(px, py - 4, pz) || c.solidAt(px, py + 4, pz) || c.solidAt(px - 8, py, pz) || c.solidAt(px + 8, py, pz)) {
        this.avoidT = 0.8;
        break;
      }
    }
    if (this.avoidT > 0) {
      // (back to the safe line just ahead, and up if low)
      const sp = c.safePoint(pos.z + this.dirZ * 30);
      tx = sp.x;
      ty = Math.max(sp.y, pos.y - 2);
      tz = pos.z + this.dirZ * 40;
      attack = false;
    }
    const row = c.row(Math.round(pos.z));
    if (pos.y < row.floor + 8) ty = Math.max(ty, row.floor + 20);
    if (this.trace) this.trace.push([pos.x, pos.y, pos.z, tx, ty, tz, found ? 1 : 0, this.avoidT > 0 ? 1 : 0, attack ? 1 : 0, fwd.x * 100, this.aimYaw * 100, this.vel.x * 10].map((n) => Math.round(n * 10) / 10)); // (tools/canyon-bot-probe.mjs)
    // ---- Fly there ----
    const d = _u;
    let bend = 0;
    if (!attack && !steer) {
      // Along the course: follow the line (its slope from here to the point
      // ahead) and close on it (the error from it, here; harder when the
      // rock is near): no corner cutting, no lag behind a bend.
      const hz = pos.z + this.dirZ * 8;
      const here = c.safePoint(hz);
      const span = Math.max(8, Math.abs(tz - hz));
      const gain = this.avoidT > 0 || !found ? 0.1 : 0.06;
      const lim = this.avoidT > 0 || !found ? 1.2 : 0.7;
      bend = Math.abs(tx - here.x) / span;
      d.set((tx - here.x) / span + clamp((here.x - pos.x) * gain, -lim, lim), (ty - here.y) / span + clamp((here.y - pos.y) * gain * 0.8, -0.5, 0.5), this.dirZ);
    } else d.set(tx - (pos.x + this.vel.x * 0.25), ty - (pos.y + this.vel.y * 0.25), tz - pos.z);
    if (d.lengthSq() < 1e-6) d.set(0, 0, this.dirZ);
    d.normalize();
    // (never back down the course: a turn round in a canyon is a crash)
    if (d.z * this.dirZ < 0.25) {
      d.z = 0.25 * this.dirZ;
      d.normalize();
    }
    // (a pilot's hand on top of the flight model: the path itself bent
    // toward where it should go, up to a turn rate, so a bandit holds the
    // canyon's line round its bends rather than drifting into a wall)
    const vl = this.vel.length();
    if (vl > 1) {
      const vd = _w.copy(this.vel).divideScalar(vl);
      const ang = vd.angleTo(d);
      if (ang > 1e-4) {
        const k = Math.min(1, (GUIDE_RATE * dt) / ang);
        _q.setFromUnitVectors(vd, _v2.copy(vd).lerp(d, k).normalize());
        this.vel.applyQuaternion(_q);
        this.q.premultiply(_q);
      }
    }
    const wantYaw = Math.atan2(-d.x, -d.z);
    const wantPitch = Math.asin(clamp(d.y, -0.7, 0.7));
    let dy = wantYaw - this.aimYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.aimYaw += dy * Math.min(1, dt * 7);
    this.aimPitch += (wantPitch - this.aimPitch) * Math.min(1, dt * 7);
    // ---- Speed: a runner a little slower than the player (faster once
    // behind), a head-on one steady; slower in the tight spots ----
    let want = 135;
    if (this.role === "runner" && pj) {
      const ps = pj.vel.length();
      want = pj.pos.z > pos.z ? Math.max(ps * 1.08 + 15, 130) : clamp(ps * 0.72, 85, 165);
    }
    if (row.W < 22 && !row.space) want = Math.min(want, 120);
    if (this.avoidT > 0) want = Math.min(want, 110);
    // (round a sharp bend, slower)
    if (bend > 0.4) want = Math.min(want, 150 - 55 * Math.min(1, (bend - 0.4) / 0.8));
    const err = want - speed;
    this.throttle = clamp(this.throttle + clamp(err * 0.02, -1, 1) * dt * 2, 0.15, 1);
    this.afterburner = err > 45;
    if (this.afterburner) this.throttle = 1;
    this._assistStick(stick);
    // ---- Guns ----
    ai.burstT -= dt;
    if (attack && dist < FIRE_RANGE && angle < 0.09 && ai.burstT <= 0 && !this.jammed && run.shieldT <= 0) {
      const b = this.skill.burst;
      ai.burstLeft = b[0] + Math.floor(Math.random() * (b[1] - b[0] + 1));
      ai.burstT = 1.6 + Math.random() * 1.6;
    }
    if (ai.burstLeft > 0 && this.cannonT <= 0 && !this.jammed) {
      ai.burstLeft--;
      this.cannonScale = this.skill.gun;
      this._fireCannon(fwd.clone());
      this.cannonScale = 1;
    }
    // ---- Flares at the player's missiles ----
    if (this.flareCool <= 0) {
      for (const m of run.jet?.missiles ?? []) {
        if (m.target?.ref === this && m.pos.distanceTo(pos) < 420) {
          this.flareCool = 7;
          if (Math.random() < 0.5) this._launchFlares();
          break;
        }
      }
    }
  }

  // The rock: over ground the world has loaded, as any jet; over ground
  // not loaded yet (a bandit far ahead), the course's own shape (the
  // world's height map there is the plateau's top: it would "land" the jet
  // on it in mid-air).
  _groundAndCrash(dt, aero) {
    const c = this.run?.course;
    const w = this.manager.world;
    if (!c || w.getChunk(Math.floor(this.pos.x) >> 4, Math.floor(this.pos.z) >> 4)) return super._groundAndCrash(dt, aero);
    const f = this.forward(_v);
    const r = this.right(_w);
    const p = this.pos;
    for (const [a, b] of [[7, 0], [0, 6], [0, -6], [-6, 0]]) {
      if (c.solidAt(p.x + f.x * a + r.x * b, p.y + f.y * a + r.y * b, p.z + f.z * a + r.z * b)) {
        this.crashWhy = `the rock (ahead of the loaded ground) at ${(p.x + f.x * a + r.x * b).toFixed(1)},${(p.y + f.y * a + r.y * b).toFixed(1)},${(p.z + f.z * a + r.z * b).toFixed(1)}`;
        return this._crash("crash");
      }
    }
  }

  // Aim: the patrols' lead, then a spread by skill.
  _assistDir(from, fwd, speed) {
    const dir = super._assistDir(from, fwd, speed);
    const s = this.skill.spread;
    dir.x += (Math.random() - 0.5) * 2 * s;
    dir.y += (Math.random() - 0.5) * 2 * s;
    dir.z += (Math.random() - 0.5) * 2 * s;
    return dir.normalize();
  }

  onDestroyed(cause) {
    // (the jet's wreck and blast; none of the patrols' bookkeeping: their
    // stats and missions aren't the canyon's)
    Jet.prototype.onDestroyed.call(this, cause);
    this.run?.bots?.onDown(this, cause);
  }
}

VehicleManager.register("canyonbot", CanyonBot);

// The bandits of a run: spawns them ahead of the player, lets them go when
// far behind, counts the kills.
export class CanyonBots {
  constructor(run, level = 0, skill = "normal") {
    this.run = run;
    this.level = BOT_LEVELS[level] || BOT_LEVELS[0];
    this.skill = skill;
    this.list = [];
    this.kills = 0;
    this.spawned = 0;
    this.lost = 0; // (into the rock on their own)
    this.timer = 6;
  }

  get count() {
    return this.level.count;
  }

  // A fresh run: none left, the counts back to 0.
  reset() {
    this.clear();
    this.kills = 0;
    this.spawned = 0;
    this.lost = 0;
    this.timer = 6;
  }

  clear() {
    const mgr = this.run.vehicles;
    for (const b of this.list) if (mgr.vehicles.includes(b)) mgr.remove(b);
    this.list.length = 0;
  }

  // (a respawn at a checkpoint: none right on top of the player)
  clearNear(pos, r = 450) {
    const mgr = this.run.vehicles;
    for (const b of this.list.slice()) {
      if (b.alive && b.pos.distanceTo(pos) < r && mgr.vehicles.includes(b)) {
        mgr.remove(b);
        this.list.splice(this.list.indexOf(b), 1);
      }
    }
    this.timer = Math.max(this.timer, 5);
  }

  update(dt) {
    const run = this.run;
    const mgr = run.vehicles;
    // (the wrecks are the manager's to clear: only the living are ours)
    this.list = this.list.filter((b) => b.alive && mgr.vehicles.includes(b));
    // (Over ground not loaded yet the vehicles wait (vehicles.js); a bandit
    // flies on: its autopilot reads the course itself, not the world.)
    const w = run.world;
    for (const b of this.list) if (!w.getChunk(Math.floor(b.pos.x) >> 4, Math.floor(b.pos.z) >> 4)) b.update(dt, null);
    if (!this.count) return;
    const pj = run.jet;
    if (!pj || !pj.alive || run.state !== "flying") return;
    for (const b of this.list.slice()) {
      // (a runner left far behind; a head-on one gone past)
      const behind = pj.pos.z - b.pos.z;
      const lostBehind = b.dirZ > 0 ? behind > BEHIND_GONE : behind > 120;
      if (lostBehind || b.pos.z - pj.pos.z > 900 || b.pos.z > run.length + 300) {
        mgr.remove(b);
        this.list.splice(this.list.indexOf(b), 1);
      }
    }
    this.timer -= dt;
    if (this.timer <= 0 && this.list.length < this.count) {
      const g = this.level.gap;
      this.timer = g[0] + Math.random() * (g[1] - g[0]);
      this.spawn();
    }
  }

  // One more, ahead of the player: a runner (the player's way) or one
  // coming head-on.
  spawn(opts = {}) {
    const run = this.run;
    const c = run.course;
    const pj = run.jet;
    if (!pj) return null;
    const dirZ = opts.dirZ ?? (Math.random() < 0.35 ? -1 : 1);
    const z = Math.round(pj.pos.z + (opts.ahead ?? AHEAD[0] + Math.random() * (AHEAD[1] - AHEAD[0])));
    if (z > run.length - 150 || z < 60) return null;
    const sp = c.safePoint(z);
    if (sp.blocked) return null;
    const row = c.row(z);
    const yaw = dirZ > 0 ? Math.PI + Math.atan2(row.sl, 1) : Math.atan2(row.sl, 1);
    const speed = dirZ > 0 ? clamp(pj.vel.length() * 0.75, 90, 160) : 130;
    const b = run.vehicles.create("canyonbot", { pos: [sp.x, sp.y, z], yaw, airborne: true, speed, throttle: 0.6, dirZ, skill: this.skill, run });
    if (!b) return null;
    b.transient = true;
    this.list.push(b);
    this.spawned++;
    return b;
  }

  onDown(b, cause) {
    const run = this.run;
    if (isPlayerCause(cause) || b.lastHitBy === "player") {
      this.kills++;
      run.onBotKilled?.(b);
    } else this.lost++;
  }
}
