// (Round 14) Helicopters in the Missions world: the aliens' hijacked
// gunships (EnemyGunship), and the manager (HeliWar) that sends them, parks
// our helicopters at the airports and the military bases, locks them until
// their mission, and counts the kills.
//
// A gunship (an Apache in the aliens' charcoal) patrols round its home until
// it sees a player (out to 900 blocks, nothing solid in between), then
// hunts them: it closes to a stand-off range and circles there, nose on,
// firing bursts from its chin gun, salvos of rockets, and at a player in a
// vehicle a guided missile now and then (flares fool it, as they fool a
// SAM). It keeps its height over the ground ahead. It is telegraphed: a
// warning when it first comes for you, its rotor's thump as it closes in.
// It goes down to the players' missiles (the jets' lock and a helicopter's
// Hellfires see it), cannon, rockets, tank shells, the bazooka; shot down,
// it spins in and blows up where it hits ("Helicopter down!").
//
// Balance: 220 hit points (two of the jets' missiles, two Hellfires, a
// tank's 3 shells); its gun stings a player on foot (a burst that lands
// costs a few hearts), its rockets hurt like a grenade, its missile is for
// vehicles. Three at most at once (weak PCs), the far ones go.
//
// Our helicopters: an airport's apron has one parked at the end by the
// tower (an Apache or a Black Hawk, by the site's seed), an airbase's
// helipad an Apache: each player's own copy until boarded (like the
// airports' aircraft: net/vehicles.js shares one when it's taken). In the
// mission chain they are locked until "Air cavalry" (a run without it: the
// jets' mission); in Creative they're anyone's.
//
// Online: the host's AI; the gunships are shared vehicles (net/vehicles.js:
// guests see puppets, their hits go to the host); their shots reach
// everyone as any vehicle's (net/fx.js); a guest's kill comes back to them
// (js/net/heli.js: "hkill").
import * as THREE from "three";
import { VehicleManager } from "./vehicles.js";
import { Heli, placeHeli } from "./vehicle-heli.js";
import { isPlayerCause } from "./damage.js";
import { IS_SOLID } from "./blocks.js";
import { voice } from "./voice.js";

const MAX_GUNSHIPS = 3;
const GUNSHIP_HP = 220;
const SIGHT = 900; // a gunship sees a player this far
const GUN_RANGE = 520;
const ROCKET_RANGE = 430;
const MISSILE_RANGE = [150, 950];
const FAR = 1900; // beyond this from every player a gunship (not a mission's) goes
const PAD_NEAR = 520; // a parked helicopter is set out within this of a player
const PAD_FAR = 850;
const GUN_DAMAGE = 3; // a round (lasers.js bolt) at a player on foot or a vehicle

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
function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Where a foe is (the body's middle, or its vehicle) and how it moves.
function foePos(f, out) {
  const v = f.vehicle;
  if (v) return out.copy(v.pos).setY(v.pos.y + (v.isGround ? 1.4 : 0));
  return out.set(f.position.x, f.position.y + 1, f.position.z);
}
function foeVel(f) {
  return f.vehicle ? f.vehicle.vel : f.velocity;
}

// ---------- The gunship ----------

export class EnemyGunship extends Heli {
  constructor(manager, data = {}) {
    super(manager, { ...data, kind: data.kind === "blackhawk" ? "blackhawk" : "apache", paint: "enemy", airborne: data.airborne ?? true }, { type: "gunship", name: "Hijacked gunship", maxHealth: GUNSHIP_HP });
    this.isEnemyHeli = true;
    this.isGunship = true;
    // (The players' weapons see the aliens' machines by this: the jets' lock
    // and missiles, tanks.js's lists; it's no ground vehicle all the same.)
    this.isEnemyGround = true;
    this.enemy = true;
    this.unusable = true;
    this.transient = true;
    this.keep = true;
    this.npc = true;
    this.alert = 0;
    this.rpm = 1;
    this.engineOn = true;
    this.home = Array.isArray(data.home) ? new THREE.Vector3().fromArray(data.home) : this.pos.clone();
    this.ai = { foe: null, pickT: rand(0, 1), seenT: 0, burst: 0, gunT: rand(2, 4), rocketT: rand(5, 8), missileT: rand(9, 13), orbit: Math.random() < 0.5 ? -1 : 1, range: rand(190, 280), wp: null, wpT: 0, warned: new Set(), cruise: rand(38, 48) };
  }

  serialize() {
    return { ...super.serialize(), type: "gunship" };
  }

  _foes() {
    return this.manager.ground?.foes?.() || [this.manager.player];
  }

  // (Who hit it, online: the kill is theirs. As tanks.js's units.)
  damage(amount, cause = "vehicle", byPlayer = false) {
    const mine = isPlayerCause(cause);
    if (mine && cause !== "pvp" && this.alive) {
      this.lastHitByPid = this.manager.currentAttacker ?? this.manager.localPid ?? 1;
      this.lastHitByT = performance.now();
    } else if (mine && this.alive) this.lastHitByT = performance.now();
    const ok = super.damage(amount, cause, byPlayer);
    if (ok && mine) this.alert = 30;
    return ok;
  }

  get killer() {
    return this.lastHitByPid && performance.now() - (this.lastHitByT ?? -1e9) < 30000 ? this.lastHitByPid : 0;
  }

  // Can it see p (nothing solid in between)?
  _sees(p) {
    const d = _w.copy(p).sub(this.pos);
    const len = d.length();
    if (len < 2) return true;
    d.divideScalar(len);
    return !this.manager.world.raycast(this.pos, d, len - 2, { solidOnly: true });
  }

  _pick() {
    let best = null;
    let bd = this.alert > 0 ? SIGHT * 1.3 : SIGHT;
    for (const f of this._foes()) {
      if (f.dead || f.creative) continue;
      const p = foePos(f, _p);
      const d = p.distanceTo(this.pos);
      if (d < bd && this._sees(p)) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  // The ground ahead (where it will be in a second or three), for its height.
  _groundAhead() {
    const mgr = this.manager;
    let g = mgr.groundBelow(this.pos.x, 300, this.pos.z);
    for (const t of [1.2, 2.6]) g = Math.max(g, mgr.groundBelow(this.pos.x + this.vel.x * t, 300, this.pos.z + this.vel.z * t));
    return g;
  }

  // The AI: where to be, which way to face; the controls that get it there.
  _control(dt) {
    const mgr = this.manager;
    const ai = this.ai;
    this.alert = Math.max(0, this.alert - dt);
    ai.pickT -= dt;
    if (ai.pickT <= 0) {
      ai.pickT = 1 + Math.random() * 0.5;
      const f = this._pick();
      if (f) {
        ai.foe = f;
        ai.seenT = 8;
      }
    }
    ai.seenT -= dt;
    const foe = ai.foe && !ai.foe.dead && !ai.foe.gone && ai.seenT > 0 ? ai.foe : null;
    if (!foe) ai.foe = null;
    const ground = this._groundAhead();
    let want = null;
    let yawWant = this.yaw;
    let alt = ground + 40;
    let maxV = ai.cruise;
    if (foe) {
      const fp = foePos(foe, this._fp || (this._fp = new THREE.Vector3()));
      const dx = this.pos.x - fp.x;
      const dz = this.pos.z - fp.z;
      const d = Math.hypot(dx, dz) || 1;
      // Circle at the stand-off range, the nose on the foe.
      const a = Math.atan2(dz, dx) + ai.orbit * 0.32;
      const r = d > ai.range * 1.6 ? d - 60 : ai.range;
      want = _u.set(fp.x + Math.cos(a) * r, 0, fp.z + Math.sin(a) * r);
      yawWant = Math.atan2(-(fp.x - this.pos.x), -(fp.z - this.pos.z));
      alt = Math.max(ground + 26, (foe.vehicle && !foe.vehicle.isGround && !foe.vehicle.onGround ? fp.y : fp.y + 22) + rand(-0.5, 0.5));
      maxV = d > ai.range * 1.6 ? 62 : 24;
      // (Now and then it switches the way round, harder to hit.)
      ai.flipT = (ai.flipT ?? rand(8, 14)) - dt;
      if (ai.flipT <= 0) {
        ai.flipT = rand(8, 14);
        ai.orbit = -ai.orbit;
      }
      // The first time it comes for a player: a warning on their screen.
      if (foe === mgr.player && !ai.warned.has("p") && d < 700) {
        ai.warned.add("p");
        mgr.onMessage?.("ENEMY GUNSHIP inbound: take cover, or shoot it down!");
      }
    } else {
      // Patrol round home.
      ai.wpT -= dt;
      if (!ai.wp || ai.wpT <= 0 || Math.hypot(ai.wp.x - this.pos.x, ai.wp.z - this.pos.z) < 30) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(60, 260);
        ai.wp = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        ai.wpT = rand(20, 35);
      }
      want = _u.set(ai.wp.x, 0, ai.wp.z);
      const vx = this.vel.x;
      const vz = this.vel.z;
      if (vx * vx + vz * vz > 25) yawWant = Math.atan2(-vx, -vz);
      else yawWant = Math.atan2(-(want.x - this.pos.x), -(want.z - this.pos.z));
    }
    // The desired velocity: toward the spot, slowing in to it.
    const ex = want.x - this.pos.x;
    const ez = want.z - this.pos.z;
    const ed = Math.hypot(ex, ez) || 1;
    const sp = Math.min(maxV, ed * 0.6);
    const vdx = (ex / ed) * sp;
    const vdz = (ez / ed) * sp;
    // (In the body's frame: forward and right.)
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const dvx = vdx - this.vel.x;
    const dvz = vdz - this.vel.z;
    const fe = dvx * fx + dvz * fz;
    const re = dvx * rx + dvz * rz;
    // (Terrain close below: up first, whatever else.)
    const low = this.pos.y - ground < 14;
    return {
      fwd: clamp(fe / 16, -1, 1) * (low ? 0.3 : 1),
      strafe: clamp(re / 16, -1, 1) * (low ? 0.3 : 1),
      yaw: clamp(wrap(yawWant - this.yaw) * 1.6, -1, 1),
      coll: low ? 1 : clamp((alt - this.pos.y) * 0.14 - this.vel.y * 0.04, -1, 1),
      engine: true,
    };
  }

  // Its weapons: gun bursts, rocket salvos, a missile at a vehicle.
  _weapons(dt, input, ctl) {
    super._weapons(dt, null, ctl);
    const ai = this.ai;
    const foe = ai.foe;
    ai.gunT -= dt;
    ai.rocketT -= dt;
    ai.missileT -= dt;
    if (!foe || foe.dead || this.crashing) {
      this._slewGun(0, this.toWorld(0, 0.5, -60, _w), dt);
      return;
    }
    const fp = foePos(foe, _p);
    const d = fp.distanceTo(this.pos);
    // (The line of sight, looked at a few times a second: a long ray.)
    ai.losT = (ai.losT ?? 0) - dt;
    if (ai.losT <= 0) {
      ai.losT = 0.3;
      ai.los = d <= SIGHT && this._sees(fp);
    }
    if (d > SIGHT || !ai.los) return;
    const fv = foeVel(foe);
    // The gun: lead a little (keep moving).
    const tof = d / this.spec.gun.speed;
    const aim = _v.copy(fp).addScaledVector(fv, tof * 0.6);
    const err = this._slewGun(0, aim, dt);
    if (ai.burst <= 0 && ai.gunT <= 0 && d < GUN_RANGE && err < 0.1) {
      ai.burst = 10 + Math.floor(Math.random() * 6);
      ai.gunT = rand(2.6, 4.2);
    }
    if (ai.burst > 0 && this.gunT <= 0 && err < 0.15) {
      ai.burst--;
      this._fireGun(0, { owner: "enemyjet", damage: GUN_DAMAGE, spread: 0.028, cause: "enemyheli_gun" });
    }
    const fwd = this.forward(_w);
    const to = _u.copy(fp).sub(this.pos).normalize();
    // Rockets: nose on, within range.
    if (ai.rocketT <= 0 && d < ROCKET_RANGE && to.angleTo(fwd) < 0.3) {
      ai.rocketT = rand(8, 11);
      const at = fp.clone().addScaledVector(fv, (d / 230) * 0.7);
      at.x += rand(-3, 3);
      at.z += rand(-3, 3);
      this.rockets = Math.max(this.rockets, 4);
      this.rocketT = 0;
      this._fireRockets({ aim: at, hostile: true, ai: true, foes: () => this._foes() });
    }
    // A guided missile at a player in a vehicle.
    if (ai.missileT <= 0 && foe.vehicle && d > MISSILE_RANGE[0] && d < MISSILE_RANGE[1] && to.angleTo(fwd) < 0.6) {
      ai.missileT = rand(14, 19);
      this.missilesLeft = Math.max(this.missilesLeft, 1);
      this.missileT = 0;
      this._fireMissile({ target: { kind: "player", ref: foe }, hostile: true, ai: true, foes: () => this._foes() });
      if (foe === this.manager.player) this.manager.onMessage?.("MISSILE LAUNCH from the gunship! Flares (C)!");
    }
  }

  hud() {
    return { title: this.name, rows: [], health: this.health / this.maxHealth };
  }
}

VehicleManager.register("gunship", EnemyGunship);

// ---------- The manager ----------

export class HeliWar {
  constructor({ vehicles, world, player, sites = null, crates = null, stats = null, progress = null, toast = null, airports = null }) {
    this.vehicles = vehicles;
    this.world = world;
    this.player = player;
    this.sites = sites;
    this.crates = crates;
    this.stats = stats;
    this.progress = progress;
    this.toast = toast;
    this.airports = airports;
    this.enabled = true;
    this.puppets = false; // (a guest: the host's gunships come as puppets)
    this.ambientAllowed = () => false;
    this.padsAllowed = () => true;
    this.locked = () => false; // (installHelis: before the helicopters' mission)
    this.onDown = []; // listeners (gunship, { mine, pid }) (the mission director)
    this.onRemoteKill = null; // (pid, gunship): a guest's kill (net/heli.js)
    this.downCount = 0;
    this.ambientT = rand(300, 480);
    this.pads = new Map(); // key -> the parked helicopter
    this._blocked = new Map(); // key -> time its spot was found taken (built over)
    this._padT = 0;
    this._farT = 0;
    vehicles.helis = this;
    vehicles.onHeliDown = (u, cause) => this._down(u, cause);
  }

  // Every gunship here (not puppets).
  get units() {
    return this.vehicles.vehicles.filter((v) => v.isGunship && v.alive && !v.puppet);
  }

  foes() {
    return this.vehicles.ground?.foes?.() || [this.player];
  }

  _near(p, r) {
    for (const f of this.foes()) if ((f.vehicle ? f.vehicle.pos : f.position).distanceTo(p) < r) return true;
    return false;
  }

  // A gunship at `at` ([x, y, z] or a Vector3, up in the air), heading yaw.
  spawnGunship(at, yaw = 0, data = {}) {
    if (this.units.length >= MAX_GUNSHIPS && !data.force) return null;
    const p = Array.isArray(at) ? at : [at.x, at.y, at.z];
    const v = this.vehicles.create("gunship", { pos: p, yaw, airborne: true, ...data });
    if (!v) return null;
    v.vel.set(-Math.sin(yaw) * 30, 0, -Math.cos(yaw) * 30);
    return v;
  }

  // One coming in from `dist` blocks off `c` (a random side), toward it.
  spawnNear(c, dist = 650, data = {}) {
    const a = data.angle ?? Math.random() * Math.PI * 2;
    const x = c.x + Math.cos(a) * dist;
    const z = c.z + Math.sin(a) * dist;
    const g = Math.max(this.vehicles.groundBelow(x, 300, z), this.world.heightAt?.(Math.floor(x), Math.floor(z)) ?? 0);
    const yaw = Math.atan2(-(c.x - x), -(c.z - z));
    const v = this.spawnGunship([x, g + 55, z], yaw, { ...data, home: [c.x, 0, c.z] });
    if (v) v.compass = a;
    return v;
  }

  // A gunship is down: whose kill, the stats, the callout, a crate.
  _down(u, cause) {
    if (!u.isGunship || u.puppet) return;
    this.downCount++;
    const pid = u.killer;
    const localPid = this.vehicles.localPid ?? 1;
    const targets = !!this.vehicles.ground?.targets;
    const mine = pid === localPid || (pid && !targets);
    if (pid && this.stats) mine ? this.stats.add("gunshipsDown") : this.stats.addWorld("gunshipsDown");
    if (mine) {
      this.toast?.("GUNSHIP DOWN!", 2.5);
      try {
        voice.say("heli", { text: Math.random() < 0.5 ? "Helicopter down!" : "Gunship down. Good kill!" });
      } catch {}
    } else if (pid) this.onRemoteKill?.(pid, u);
    if (pid && this.crates?.enabled && Math.random() < 0.5) this.crates.drop({ center: u.pos, dist: 8, at: u.pos.clone() });
    for (const fn of this.onDown) fn(u, { mine, pid });
  }

  // ---------- The parked helicopters ----------

  // A site's places for a helicopter: [{ x, y, z, yaw, kind, key }]: the
  // airbase's helipad, and the end of every apron by the tower.
  padSpots(site) {
    if (!site || !this.sites) return [];
    if (site._heliPads) return site._heliPads;
    const S = this.sites;
    const out = [];
    const [vx, vz] = S.dirV(site);
    const yaw = Math.atan2(vx, vz);
    const seed = (site.seed ?? 0) >>> 0;
    if (site.base?.helipad) {
      const hp = site.base.helipad;
      const [x, z] = S.toWorld(site, hp.u, hp.v);
      out.push({ x: x + 0.5, y: site.y + 1, z: z + 0.5, yaw: yaw + Math.PI / 2, kind: "apache", key: `${site.id}#hp` });
    }
    const a = site.apron;
    const t = site.tower;
    if (a && t) {
      // (The tower's end of the apron is kept free of hangars: the pad is behind the tower, at the back.)
      const towerHigh = t.u0 > (a.u0 + a.u1) / 2;
      const u = towerHigh ? a.u1 - 14 : a.u0 + 14;
      const v = a.v1 - 13;
      const [x, z] = S.toWorld(site, u, v);
      out.push({ x: x + 0.5, y: site.y + 1, z: z + 0.5, yaw: yaw + Math.PI / 2, kind: seed % 5 < 3 ? "apache" : "blackhawk", key: `${site.id}#ha` });
    }
    site._heliPads = out;
    return out;
  }

  // Room for a helicopter at the spot: the rotor's sweep and the cabin clear,
  // something to stand on.
  _clear(s) {
    const w = this.world;
    const g = this.vehicles.groundBelow(s.x, s.y + 6, s.z);
    if (Math.abs(g - s.y) > 2) return null;
    const solid = (x, y, z) => IS_SOLID[w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const r of [2.5, 5, 7]) {
        if (solid(s.x + Math.cos(a) * r, g + 1, s.z + Math.sin(a) * r) || solid(s.x + Math.cos(a) * r, g + 3.6, s.z + Math.sin(a) * r)) return null;
      }
    }
    return g;
  }

  _padUpkeep() {
    const sites = this.sites;
    if (!sites?.within) return;
    const allowed = this.padsAllowed();
    const centers = this.foes().map((f) => (f.vehicle ? f.vehicle.pos : f.position));
    if (!centers.length) centers.push(this.player.position);
    const taken = this.airports?.taken;
    const now = performance.now() / 1000;
    if (allowed) {
      for (const c of centers) {
        for (const s of sites.within(c.x, c.z, PAD_NEAR + 400)) {
          for (const spot of this.padSpots(s)) {
            if (Math.hypot(spot.x - c.x, spot.z - c.z) > PAD_NEAR) continue;
            if (this.pads.has(spot.key) || taken?.has(spot.key)) continue;
            if (now - (this._blocked.get(spot.key) ?? -1e9) < 30) continue;
            if (!this.world.getChunk(Math.floor(spot.x) >> 4, Math.floor(spot.z) >> 4)) continue;
            // (Nor while the one a player took from here is still about.)
            if (this.vehicles.vehicles.some((o) => o.alive && o.tookKey === spot.key)) continue;
            const g = this._clear(spot);
            if (g === null) {
              this._blocked.set(spot.key, now);
              continue;
            }
            const v = placeHeli(this.vehicles, spot.kind, new THREE.Vector3(spot.x, g, spot.z), spot.yaw, { paint: spot.kind === "blackhawk" ? "black" : (s.seed >>> 3) % 3 === 0 ? "desert" : "army" });
            if (!v) continue;
            v.parkedAt = s.id;
            v.parkKey = spot.key;
            v.transient = true;
            v.keep = true;
            v.npc = true;
            this.pads.set(spot.key, v);
          }
        }
      }
    }
    for (const [key, v] of this.pads) {
      const gone = !this.vehicles.vehicles.includes(v) || !v.parkedAt;
      if (gone) {
        // (Boarded: a player's helicopter now; blown up: set out again later.)
        if (this.vehicles.vehicles.includes(v)) {
          v.tookKey = key;
          v.npc = false;
          v.keep = false;
        }
        this.pads.delete(key);
        continue;
      }
      const far = centers.every((c) => Math.hypot(v.pos.x - c.x, v.pos.z - c.z) > PAD_FAR);
      if ((far || !allowed || taken?.has(key)) && !v.occupied) {
        this.vehicles.remove(v);
        this.pads.delete(key);
      }
    }
  }

  // ---------- Ambient gunships ----------

  // Now and then (after the helicopters' mission, nothing else on): one
  // gunship hunting the players, from a few hundred blocks off.
  _ambient(dt) {
    if (this.puppets || !this.ambientAllowed()) return;
    if (this.units.length) return;
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    this.ambientT = rand(360, 600);
    const foes = this.foes();
    if (!foes.length) return;
    const f = foes[Math.floor(Math.random() * foes.length)];
    const c = f.vehicle ? f.vehicle.pos : f.position;
    const v = this.spawnNear(c, rand(650, 800));
    if (!v) return;
    v.ambient = true;
    const a = v.compass ?? 0;
    const dir = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][Math.round(((Math.atan2(Math.sin(a), Math.cos(a)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    this.toast?.(`An enemy gunship is hunting to the ${dir}: listen for its rotor!`, 5);
  }

  update(dt) {
    const veh = this.vehicles;
    const off = !veh.enabled || !this.enabled;
    if (off) {
      for (const u of this.units) veh.remove(u);
      for (const [, v] of this.pads) if (!v.occupied && veh.vehicles.includes(v)) veh.remove(v);
      this.pads.clear();
      return;
    }
    this._padT -= dt;
    if (this._padT <= 0) {
      this._padT = 1;
      this._padUpkeep();
    }
    if (this.puppets) return;
    this._ambient(dt);
    this._farT -= dt;
    if (this._farT <= 0) {
      this._farT = 1;
      for (const u of this.units) if (!u.mission && !this._near(u.pos, FAR)) veh.remove(u);
    }
  }

  clear() {
    for (const u of this.units) this.vehicles.remove(u);
  }
}

// The first helicopter mission of this run ("Air cavalry"; a run drawn
// before it existed: the jets' mission).
export function heliMissionId(progress) {
  return progress?.indexOf?.("air_cav") >= 0 ? "air_cav" : "wings";
}

// Wires the helicopters into the game (called once by main.js, after the
// ground war; returns the HeliWar). game: { world, player, vehicles, crates,
// stats, progress, missions, airports, toast, mods }. It runs right after the
// vehicles each frame.
export function installHelis(game) {
  const veh = game.vehicles;
  if (veh.helis) return veh.helis;
  const war = new HeliWar({ vehicles: veh, world: game.world, player: game.player, sites: game.world?.terrain?.sites || game.sites || null, crates: game.crates, stats: game.stats, progress: game.progress, toast: game.toast, airports: game.airports });
  const progress = game.progress;
  const player = game.player;
  // Locked until the helicopters' mission (Creative: never).
  war.locked = () => !player.creative && !!progress?.enabled && !progress.reached?.(heliMissionId(progress));
  const missionRef = () => {
    const m = progress?.missionById?.(heliMissionId(progress));
    return m ? `mission ${m.n + 1} ("${m.title}")` : "a later mission";
  };
  const prevCan = veh.canBoard;
  veh.canBoard = (v) => (v.type === "heli" && war.locked() ? `Helicopters join the fight with ${missionRef()}. Esc > Missions shows the way there.` : prevCan ? prevCan(v) : null);
  // (After "Air cavalry" in the chain: a gunship now and then.)
  war.ambientAllowed = () => !!progress?.enabled && !player.creative && game.mods?.enabled !== false && progress.indexOf?.("air_cav") >= 0 && !!progress.isDone?.("air_cav");
  const update = veh.update.bind(veh);
  veh.update = (dt) => {
    update(dt);
    war.update(dt);
  };
  if (game.missions?.attachHelis) game.missions.attachHelis(war);
  return war;
}
