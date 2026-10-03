// Vehicles online. Every shared vehicle has a network id (nid, "pid:n") and
// an owner: the peer that drives it (or drove it last). The owner simulates
// it and sends its state (20 times a second while it moves, now and then
// when it stands still); everyone else has a *puppet*: the same vehicle
// object and model, driven from the received states (position, attitude,
// throttle, afterburner, gear, control surfaces, air brakes, tilt, beam,
// health, wreck).
//
// Aircraft parked at airports (and the hangar ships) are not shared: every
// peer sets out the same ones from the seed. The first player to board one
// makes it shared ("vadd" with the parking spot), and the other peers put
// their copy of that spot away for good.
//
// Boarding someone else's empty vehicle is a claim: the host grants it to the
// first who asks ("vown"); the old owner's copy becomes a puppet and the new
// owner's puppet becomes the real thing. A vehicle someone is sitting in
// can't be claimed.
import * as THREE from "three";
import { Interp, r2, r3, vec2, vec1 } from "./interp.js";
import { RATES } from "./config.js";
import { HOST_PID } from "./session.js";

const IDLE_SEND = 1.0; // seconds between states of a vehicle that stands still
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class VehicleSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.vehicles = mp.game.vehicles;
    this.byId = new Map(); // nid -> vehicle (ours or a puppet)
    this._n = 1;
    this._sendT = 0;
    this._creatingPuppet = false;
    this.pendingClaim = null; // { nid, t }
    this._pendingAdopt = [];
    const net = this.net;
    net.on("vadd", (m, from) => this._onAdd(m, from));
    net.on("vs", (m, from) => this._onStates(m, from));
    net.on("vdead", (m, from) => this._onDead(m, from));
    net.on("vrem", (m, from) => this._onRemove(m, from));
    net.on("vclaim", (m, from) => this._onClaim(m, from));
    net.on("vown", (m) => this._onOwn(m));
    net.on("vdeny", (m) => this._onDeny(m));
    net.on("vhit", (m, from) => this._onHit(m, from));
    net.registerSync("vehicles", {
      save: () => this._snapshot(),
      load: (list) => this._loadSnapshot(list),
    });
    this._hooked = false;
  }

  // ---------- Lifecycle ----------

  start() {
    if (!this._hooked) this._hook();
    // Host: what is already in the world is shared from now on.
    if (this.net.isHost) for (const v of this.vehicles.vehicles) this._adopt(v, false);
  }

  stop() {
    // The session is over: puppets go, our own vehicles stay ours.
    for (const v of [...this.vehicles.vehicles]) {
      if (v.puppet) this._removeLocal(v);
      else v.net = null;
    }
    this.byId.clear();
    this.pendingClaim = null;
  }

  playerLeft(p) {
    // Its vehicles: the one it sat in goes; the others become the host's
    // (they stay parked in the world).
    for (const v of [...this.byId.values()]) {
      if (!v.net || v.net.owner !== p.pid) continue;
      const occupiedByIt = v.netOcc === p.pid;
      if (occupiedByIt || !v.alive) {
        this.byId.delete(v.net.nid);
        this._removeLocal(v);
      } else if (this.net.isHost) {
        this._makeOwned(v);
        this._broadcastOwn(v.net.nid, HOST_PID);
      }
    }
  }

  byNid(nid) {
    return this.byId.get(nid) || null;
  }

  // ---------- Hooks into the vehicle manager ----------

  _hook() {
    this._hooked = true;
    const vm = this.vehicles;
    const prevAdded = vm.onAdded;
    vm.onAdded = (v) => {
      prevAdded?.(v);
      // (Looked at on the next update: an airport marks its parked aircraft
      // right after creating them, and those stay local.)
      if (this.mp.active && !this._creatingPuppet) this._pendingAdopt.push(v);
    };
    const prevRemoved = vm.onRemoved;
    vm.onRemoved = (v) => {
      prevRemoved?.(v);
      if (!this.mp.active || !v.net) return;
      if (!v.puppet && v.net.owner === this.net.pid) this.net.toAll({ t: "vrem", nid: v.net.nid });
      if (this.byId.get(v.net.nid) === v) this.byId.delete(v.net.nid);
    };
    const prevDestroyed = vm.onDestroyedHook;
    vm.onDestroyedHook = (v, cause) => {
      prevDestroyed?.(v, cause);
      if (this.mp.active && v.net && !v.puppet) this.net.toAll({ t: "vdead", nid: v.net.nid, cause });
    };
    const prevEnter = vm.onEnter;
    vm.onEnter = (v) => {
      if (this.mp.active) this._entered(v);
      prevEnter?.(v);
    };
    // (canBoard is a question, asked every frame for the "Press F" hint too:
    // the claim itself is made when boarding.)
    const prevCan = vm.canBoard;
    vm.canBoard = (v) => {
      if (this.mp.active && v.puppet && v.netOcc) return `${this.mp.playerName(v.netOcc)} is flying it`;
      if (this.mp.active && v.puppet && (!v.alive || v.wreck)) return "It's a wreck";
      return prevCan ? prevCan(v) : null;
    };
    const enter = vm.enter.bind(vm);
    vm.enter = (v) => {
      // Someone else's vehicle: ask the host for it first (we climb in when it says yes).
      if (this.mp.active && v?.puppet) {
        const why = this._claim(v);
        vm.onMessage?.(why);
        return false;
      }
      return enter(v);
    };
  }

  // A local vehicle becomes shared (unless it's an enemy fighter, which is
  // the host's AI, or an aircraft still parked at an airport).
  _adopt(v, announce) {
    if (v.net || v.puppet || v.isEnemyJet || v.parkedAt) return;
    const nid = `${this.net.pid}:${this._n++}`;
    v.net = { nid, owner: this.net.pid };
    this.byId.set(nid, v);
    if (announce) this.net.toAll({ t: "vadd", nid, owner: this.net.pid, type: v.type, data: v.serialize() });
  }

  // We boarded something: a parked aircraft becomes shared now.
  _entered(v) {
    if (v.puppet) return;
    if (!v.net && v.parkedAt) {
      const key = v.parkKey;
      v.parkedAt = null; // (airports.boarded() runs next)
      this._adopt(v, false);
      this.net.toAll({ t: "vadd", nid: v.net.nid, owner: this.net.pid, type: v.type, data: v.serialize(), took: key || null });
    }
  }

  // ---------- Puppets ----------

  _createPuppet(nid, owner, type, data) {
    if (this.byId.has(nid)) return this.byId.get(nid);
    this._creatingPuppet = true;
    let v = null;
    try {
      v = this.vehicles.create(type, data || {});
    } finally {
      this._creatingPuppet = false;
    }
    if (!v) return null;
    this._makePuppet(v, nid, owner);
    return v;
  }

  _makePuppet(v, nid, owner) {
    v.net = { nid, owner };
    v.puppet = true;
    v.transient = true; // (never saved: its owner keeps it)
    v.keep = true;
    v.interp = v.interp || new Interp({ angles: ["y"], quats: ["q"], snap: 60 });
    v.netOcc = v.netOcc || 0;
    if (!v._realUpdate) v._realUpdate = v.update;
    v.update = (dt) => this._drivePuppet(v, dt);
    if (!v._realDamage) v._realDamage = v.damage;
    v.damage = (amount, cause, byPlayer) => this._puppetDamage(v, amount, cause, byPlayer);
    this.byId.set(nid, v);
  }

  // A puppet becomes ours (a claim was granted): real updates and damage again.
  _makeOwned(v) {
    if (!v.puppet) return;
    v.puppet = false;
    v.update = v._realUpdate;
    v.damage = v._realDamage;
    v.transient = false;
    v.keep = v.type === "ufo" && !v.wreck;
    v.net.owner = this.net.pid;
    v.interp?.clear();
    // Where it was last seen, at rest.
    if (v.type === "jet") {
      v.throttle = 0;
      v.afterburner = false;
    }
    v.vel.set(0, 0, 0);
    v.netOcc = 0;
  }

  _removeLocal(v) {
    this._creatingPuppet = true;
    try {
      if (this.vehicles.vehicles.includes(v)) this.vehicles.remove(v);
      else v.dispose?.();
    } finally {
      this._creatingPuppet = false;
    }
  }

  _drivePuppet(v, dt) {
    v.hurtTime += dt;
    v.time = (v.time || 0) + dt;
    const st = v.interp.sample(this.net.time);
    if (st) {
      v.pos.fromArray(st.p);
      if (st.v) v.vel.fromArray(st.v);
      if (Number.isFinite(st.hp)) v.health = st.hp;
      if (!v.isEnemyJet) {
        v.netOcc = st.o | 0;
        v.occupied = !!v.netOcc;
        v.unusable = !!v.netOcc || v.wreck || !v.alive;
      }
    }
    const night = this.vehicles.night ?? 0;
    if (v.type === "jet" || v.isEnemyJet) {
      if (st) {
        if (st.q) v.q.fromArray(st.q);
        v.throttle = st.th ?? 0;
        v.afterburner = !!(st.f & 1);
        v.onGround = !!(st.f & 2);
        v.brake = !!(st.f & 4);
        v.gearT = st.g ?? v.gearT;
        v.airbrake = st.ab ?? 0;
        if (st.s) {
          v.surf.pitch = st.s[0];
          v.surf.roll = st.s[1];
          v.surf.yaw = st.s[2];
        }
        // The roll rate (for the missile roll evasion of their own missiles,
        // and the effects), from the change of attitude.
        if (v._lastQ) {
          _q.copy(v._lastQ).invert().multiply(v.q);
          _e.setFromQuaternion(_q, "YXZ");
          const k = 1 / Math.max(1e-3, dt);
          v.angVel.set(_e.x * k, _e.y * k, _e.z * k);
        } else v._lastQ = new THREE.Quaternion();
        v._lastQ.copy(v.q);
        // The roll done lately (another player's missile at this jet can be rolled away from).
        v.rollAcc = (v.rollAcc || 0) * Math.exp(-dt / 2.2) + (v.onGround ? 0 : v.angVel.z * dt);
        v.rollEvadeT = Math.max(0, (v.rollEvadeT || 0) - dt);
      }
      v._place();
      if (v.alive) {
        v.model.setThrottle(v.throttle, v.afterburner, v.time);
        v.model.setLights(v.time, night);
        v.model.setControls?.(v.surf.pitch, v.surf.roll, v.surf.yaw, v.airbrake);
        v.model.setGear(v.gearT);
        v._effects(dt, null);
      } else {
        v.model.setBurnt?.(true, v.time);
        this._wreckFx(v, dt);
      }
      v._updateMissiles?.(dt);
      v._updateFlares?.(dt);
    } else if (v.type === "ufo") {
      if (st) {
        v.yaw = st.y ?? v.yaw;
        if (st.tl) v.tilt.set(st.tl[0], 0, st.tl[1]);
        const beam = !!(st.f & 1);
        if (beam !== v._netBeam || beam) {
          v._netBeam = beam;
          const top = v.pos.clone();
          top.y -= v.bottom;
          const bottom = st.bb ?? top.y - 10;
          v.beam.set(beam, top, bottom, st.br ?? Math.max(2.5, v.radius * 0.8), !!(st.f & 2));
        }
        if ((st.f & 4) && !v.downed) {
          v.downed = true;
          v.model.setDead(true);
        }
        v.crashed = !!(st.f & 8);
      }
      v.beam.update(dt, this.game.effects);
      v._place();
      v.model.lightsOn = v.downed ? 0 : 1;
      v.model.animate(v.time, { night, damage: 1 - v.health / v.maxHealth, beam: v.beam.strength, speed: v.vel.length() });
    } else {
      v.root.position.copy(v.pos);
    }
  }

  _wreckFx(v, dt) {
    v._wfx = (v._wfx || 0) - dt;
    if (v._wfx > 0 || !v.root.visible) return;
    v._wfx = 0.05;
    const fx = this.game.effects;
    const c = this._wreckC || (this._wreckC = { fire: new THREE.Color(5, 2.6, 0.9), s0: new THREE.Color(0.06, 0.055, 0.05), s1: new THREE.Color(0.28, 0.27, 0.26) });
    const j = () => (Math.random() - 0.5) * 2.5;
    fx.glow.spawn({ x: v.pos.x + j(), y: v.pos.y + j() * 0.5, z: v.pos.z + j(), vx: j(), vy: 1, vz: j(), life: 0.45, size0: 3.4, size1: 1, color0: c.fire, alpha: 0.65, drag: 1.5 });
    fx.smoke.spawn({ x: v.pos.x + j(), y: v.pos.y, z: v.pos.z + j(), vx: j() * 0.4, vy: 0.5, vz: j() * 0.4, life: 4, size0: 2.2, size1: 10, color0: c.s0, color1: c.s1, alpha: 0.75, drag: 0.5 });
  }

  // Damage to someone else's vehicle. Blasts are judged by the owner itself
  // (the explosion reaches it too), as are the AI's laser bolts (they fly
  // there too). Anything else goes to the owner: this player's shots,
  // cannon, missiles (the shooter's call), and on the host the AI's
  // missiles, sweeping lasers and the like (the host's call).
  _puppetDamage(v, amount, cause, byPlayer) {
    if (!v.alive || amount <= 0) return false;
    if (cause === "explosion" || cause === "explosion_other") return false;
    const mine = cause === "player" || cause === "cannon" || cause === "beam" || cause === "missile" || cause === "pvp";
    if (!mine && !this.net.isHost) return false;
    // Players hurt each other's aircraft only with the host's PvP rule on (always in a
    // Dogfight, and not someone who is out of the match, watching).
    if (mine && v.netOcc && !this.mp.pvpAllowed()) return false;
    v.hurtTime = 0;
    this.net.toAll({ t: "vhit", nid: v.net.nid, dmg: Math.round(amount * 10) / 10, cause, by: this.net.pid });
    this.game.hud?.hitMarker?.();
    return true;
  }

  _onHit(m, from) {
    const v = this.byId.get(m.nid);
    if (!v || v.puppet || !v.alive) return;
    const by = m.by || from;
    v.lastHitByPid = by;
    v.lastHitByT = performance.now();
    (v._realDamage || v.damage).call(v, m.dmg, m.cause === "beam" ? "beam" : "pvp", true);
  }

  // ---------- Claims ----------

  // Boarding someone else's empty vehicle: ask the host first.
  _claim(v) {
    if (v.netOcc) return `${this.mp.playerName(v.netOcc)} is flying it`;
    if (!v.alive || v.wreck) return "It's a wreck";
    const t = performance.now();
    if (this.pendingClaim && this.pendingClaim.nid === v.net.nid && t - this.pendingClaim.t < 3000) return "Climbing in...";
    this.pendingClaim = { nid: v.net.nid, t };
    if (this.net.isHost) this._grant(v.net.nid, HOST_PID);
    else this.net.toHost({ t: "vclaim", nid: v.net.nid });
    return "Climbing in...";
  }

  _onClaim(m, from) {
    if (!this.net.isHost) return;
    this._grant(m.nid, from);
  }

  _grant(nid, pid) {
    const v = this.byId.get(nid);
    const busy = !v || !v.alive || (v.puppet ? v.netOcc && v.netOcc !== pid : v === this.vehicles.active);
    if (busy) {
      if (pid !== HOST_PID) this.net.send(pid, { t: "vdeny", nid });
      else this._onDeny({ nid });
      return;
    }
    this._broadcastOwn(nid, pid);
    this._onOwn({ nid, owner: pid });
  }

  _broadcastOwn(nid, owner) {
    const v = this.byId.get(nid);
    this.net.broadcast({ t: "vown", nid, owner, data: v && !v.puppet ? v.serialize() : null });
  }

  _onOwn(m) {
    const v = this.byId.get(m.nid);
    if (!v) return;
    if (m.owner === this.net.pid) {
      // Ours now: the puppet becomes the real vehicle, and we climb in if we asked.
      const wanted = this.pendingClaim && this.pendingClaim.nid === m.nid;
      this.pendingClaim = null;
      this._makeOwned(v);
      if (wanted && !this.vehicles.active && !this.game.player.dead) this.vehicles.enter(v);
    } else {
      if (!v.puppet) {
        // Someone else's now: we stop simulating it.
        if (v === this.vehicles.active) this.vehicles.exit({ force: true });
        this._makePuppet(v, m.nid, m.owner);
      } else v.net.owner = m.owner;
    }
  }

  _onDeny(m) {
    if (this.pendingClaim?.nid === m.nid) this.pendingClaim = null;
    this.game.toast?.("Someone else got there first.", 2);
  }

  // ---------- Messages ----------

  _onAdd(m, from) {
    if (m.owner === this.net.pid) return;
    if (m.took) this.game.airports.takeParked(m.took);
    if (this.byId.has(m.nid)) return;
    this._createPuppet(m.nid, m.owner, m.type, m.data);
  }

  _onStates(m, from) {
    const now = this.net.time;
    for (const s of m.l || []) {
      const v = this.byId.get(s.n);
      if (!v || !v.puppet) continue;
      s.ts = m.ts;
      v.interp.push(s, now);
    }
    if (this.net.isHost) this.net.broadcast(m, { fast: true, except: from });
  }

  _onDead(m, from) {
    const v = this.byId.get(m.nid);
    if (!v || !v.puppet || !v.alive) return;
    // A puppet goes down without blowing anything up here (the owner's blast
    // reaches everyone as an explosion of its own).
    v.alive = false;
    v.netOcc = 0;
    v.removeAt = 60; // (the owner says when the wreck is gone)
    if (v.type === "ufo") {
      v.root.visible = false;
      v.beam.set(false);
    } else if (v.type === "jet") v.model.setBurnt?.(true, v.time || 0);
  }

  _onRemove(m) {
    const v = this.byId.get(m.nid);
    if (!v || !v.puppet) return;
    this.byId.delete(m.nid);
    this._removeLocal(v);
  }

  // ---------- Sending ----------

  _state(v) {
    const s = { n: v.net.nid, p: vec2(v.pos), v: vec1(v.vel), hp: Math.round(v.health), o: v === this.vehicles.active ? this.net.pid : 0 };
    if (v.type === "jet" || v.isEnemyJet) {
      s.q = v.q.toArray().map(r3);
      s.th = r2(v.throttle);
      s.f = (v.afterburner ? 1 : 0) | (v.onGround ? 2 : 0) | (v.brake ? 4 : 0);
      s.g = r2(v.gearT);
      s.ab = r2(v.airbrake || 0);
      s.s = [r2(v.surf.pitch), r2(v.surf.roll), r2(v.surf.yaw)];
    } else if (v.type === "ufo") {
      s.y = r3(v.yaw);
      s.tl = [r3(v.tilt.x), r3(v.tilt.z)];
      s.f = (v.beam?.on ? 1 : 0) | (v.beam?.floating ? 2 : 0) | (v.downed ? 4 : 0) | (v.crashed ? 8 : 0);
      if (v.beam?.on) {
        s.bb = r2(v.beam.bottomY);
        s.br = r2(v.beam.radius ?? v.radius);
      }
    }
    return s;
  }

  update(dt) {
    if (this._pendingAdopt.length) {
      for (const v of this._pendingAdopt) if (this.vehicles.vehicles.includes(v) && v.alive) this._adopt(v, true);
      this._pendingAdopt.length = 0;
    }
    if (!this.mp.stateLoaded) return;
    this._sendT -= dt;
    if (this._sendT > 0) return;
    this._sendT = 1 / RATES.player;
    const list = [];
    const t = performance.now() / 1000;
    for (const v of this.byId.values()) {
      if (v.puppet || !v.net || v.net.owner !== this.net.pid) continue;
      if (!this.vehicles.vehicles.includes(v)) continue;
      const moving = v === this.vehicles.active || v.vel.lengthSq() > 0.01 || !v.alive;
      if (!moving && t - (v._lastSent || 0) < IDLE_SEND) continue;
      v._lastSent = t;
      list.push(this._state(v));
    }
    if (!list.length) return;
    const msg = { t: "vs", ts: r3(this.net.time), l: list };
    if (this.net.isHost) this.net.broadcast(msg, { fast: true });
    else this.net.toHost(msg, { fast: true });
  }

  // ---------- Joining ----------

  // Host: every shared vehicle, for a player who joins.
  _snapshot() {
    const out = [];
    for (const v of this.byId.values()) {
      if (!v.alive || !this.vehicles.vehicles.includes(v)) continue;
      const data = v.serialize();
      // (A puppet's data is where it is drawn now.)
      out.push({ nid: v.net.nid, owner: v.net.owner, type: v.type, data, occ: v.puppet ? v.netOcc : v === this.vehicles.active ? HOST_PID : 0 });
    }
    return { list: out, taken: [...this.game.airports.taken] };
  }

  _loadSnapshot(snap) {
    if (!snap) return;
    for (const key of snap.taken || []) this.game.airports.takeParked(key);
    for (const e of snap.list || []) {
      if (e.owner === this.net.pid) continue;
      const v = this._createPuppet(e.nid, e.owner, e.type, e.data);
      if (v) v.netOcc = e.occ || 0;
    }
  }
}
