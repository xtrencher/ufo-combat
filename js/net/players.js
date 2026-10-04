// Remote players: every player sends its own state 20 times a second
// (position, velocity, look, what it holds, its swing, a few flags, health,
// the vehicle it sits in); the host passes the clients' states on to the
// other clients. Each remote player is drawn with the player model (walks,
// sneaks, looks where they look, swings, holds their item, under a
// parachute when they have one open), interpolated ~0.1 s in the past, with
// a nameplate over their head or over their vehicle.
import * as THREE from "three";
import { PlayerAvatar } from "../player-avatar.js";
import { Parachute } from "../vehicles.js";
import { MAX_HEALTH } from "../player.js";
import { Nameplate } from "./nameplate.js";
import { Interp, r2, r3, vec2, vec1 } from "./interp.js";
import { RATES } from "./config.js";
import { HOST_PID } from "./session.js";

export const PF = { ground: 1, sneak: 2, dead: 4, fly: 8, chute: 16, water: 32, sprint: 64, creative: 128 };

export class RemotePlayer {
  constructor(sync, info) {
    const g = sync.game;
    this.sync = sync;
    this.pid = info.pid;
    this.nick = info.nick;
    this.color = info.color;
    this.interp = new Interp({ angles: ["y", "pi"], snap: 24 });
    this.avatar = new PlayerAvatar(g.scene, g.world.atlas);
    this.plate = new Nameplate(g.scene, this.nick, this.color);
    this.chute = null;
    // What the avatar and the AI see (a Player-like view of the remote player).
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.sneaking = false;
    this.dead = false;
    this.flying = false;
    this.inWater = false;
    this.parachute = false;
    this.creative = false;
    this.walkPhase = 0;
    this.health = MAX_HEALTH;
    this.heldId = 0;
    this.swing = 1;
    this.vehicleNid = 0;
    this.seen = false; // a state has arrived
    this.lastHeard = 0;
    // The newest known state (AI targets aim at where the player is now, not
    // where they are drawn).
    this.livePos = new THREE.Vector3();
    this.liveVel = new THREE.Vector3();
  }

  get mode() {
    return this.creative ? "creative" : "survival";
  }

  // The vehicle this player sits in (a puppet here), if any.
  get vehicle() {
    return this.vehicleNid ? this.sync.mp.vehicles?.byNid(this.vehicleNid) ?? null : null;
  }

  receive(msg, now) {
    this.interp.push(msg, now);
    this.lastHeard = now;
    this.seen = true;
    const last = this.interp.last;
    if (last === msg) {
      this.livePos.fromArray(msg.p);
      this.liveVel.fromArray(msg.v || [0, 0, 0]);
      this.vehicleNid = msg.veh || 0;
      this.health = Number.isFinite(msg.hp) ? msg.hp : this.health;
      const f = msg.f | 0;
      this.dead = !!(f & PF.dead);
      this.creative = !!(f & PF.creative);
    }
  }

  update(dt, now) {
    const st = this.interp.sample(now);
    if (!st) {
      this.avatar.root.visible = false;
      this.plate.place(0, -1000, 0, false);
      return;
    }
    const f = st.f | 0;
    this.position.fromArray(st.p);
    this.velocity.fromArray(st.v || [0, 0, 0]);
    this.yaw = st.y || 0;
    this.pitch = st.pi || 0;
    this.onGround = !!(f & PF.ground);
    this.sneaking = !!(f & PF.sneak);
    this.flying = !!(f & PF.fly);
    this.inWater = !!(f & PF.water);
    this.parachute = !!(f & PF.chute);
    this.heldId = st.h | 0;
    this.swing = Number.isFinite(st.sw) ? st.sw : 1;
    this.bowDraw = Number.isFinite(st.bw) ? st.bw : 0;
    this.shots = Number.isFinite(st.fx) ? st.fx : null;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && speed > 0.5) this.walkPhase += speed * dt * 1.6;
    // The live position: the newest state, carried forward a little.
    const last = this.interp.last;
    if (last) {
      const age = Math.min(0.3, Math.max(0, now - last.ts));
      this.livePos.fromArray(last.p).addScaledVector(this.liveVel, age);
    }
    const g = this.sync.game;
    const veh = this.vehicle;
    const inVehicle = !!veh || !!this.vehicleNid;
    const light = g.world.lightAt(this.position.x, this.position.y + 1, this.position.z);
    this.avatar.update(dt, this, light, { visible: !inVehicle && !this.dead, swing: this.swing, heldId: this.heldId, bowDraw: this.bowDraw, shots: this.shots });
    // The parachute.
    if (this.parachute && !inVehicle && !this.dead) {
      if (!this.chute) this.chute = new Parachute(g.scene);
      this.chute.active = true;
      this.chute.pending = 0;
      this.chute.update(dt, this, null);
    } else if (this.chute?.active) this.chute.close(null);
    // The nameplate: over the head, or over the vehicle.
    const me = g.player.position;
    let px = this.position.x;
    let py = this.position.y + 2.25;
    let pz = this.position.z;
    if (veh) {
      px = veh.pos.x;
      py = veh.pos.y + Math.max(2.5, (veh.radius ?? 3) * 0.55) + 1.2;
      pz = veh.pos.z;
    }
    const d = Math.hypot(px - me.x, py - me.y, pz - me.z);
    const extra = d > 40 ? `${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`}` : "";
    const showHealth = !this.creative && !inVehicle && !this.dead && this.sync.mp.mode !== "dogfight";
    const hp = showHealth ? Math.round((this.health / MAX_HEALTH) * 20) / 20 : -1;
    // (A change of distance alone redraws the plate 4 times a second at most:
    // each redraw re-uploads its texture, every frame for a fast jet.)
    const text = this.dead ? "(down)" : extra;
    const pl = this.plate;
    if (text === pl.extra || pl.nick !== this.nick || pl.color !== this.color || pl.health !== hp || this.dead || now - (this._plateT ?? -9) > 0.25) {
      if (text !== pl.extra) this._plateT = now;
      pl.set(this.nick, this.color, text, hp);
    }
    this.plate.place(px, py, pz, !this.dead || d < 200);
  }

  dispose() {
    const g = this.sync.game;
    g.scene.remove(this.avatar.root);
    this.plate.dispose();
    // (Its own materials: the flash texture and the atlas are shared.)
    const a = this.avatar;
    a.materials.array.dispose();
    a.materials.color.dispose();
    a.flash.material.dispose();
    if (this.chute) {
      this.chute.close(null);
      g.scene.remove(this.chute.group);
      const c = this.chute;
      c.canopy.geometry.dispose();
      c.canopy.material.dispose();
      c.lines.geometry.dispose();
      c.lines.material.dispose();
    }
  }
}

export class PlayerSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.remotes = new Map(); // pid -> RemotePlayer
    this._sendT = 0;
    this.net.on("ps", (msg, from) => this._onState(msg, from));
  }

  // ---------- Lifecycle ----------

  start() {
    for (const p of this.net.players.values()) if (p.pid !== this.net.pid) this._ensure(p);
  }

  stop() {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }

  playerJoined(p) {
    if (p.pid !== this.net.pid) this._ensure(p);
  }

  playerLeft(p) {
    const r = this.remotes.get(p.pid);
    if (!r) return;
    r.dispose();
    this.remotes.delete(p.pid);
  }

  _ensure(info) {
    let r = this.remotes.get(info.pid);
    if (!r) {
      r = new RemotePlayer(this, info);
      this.remotes.set(info.pid, r);
    } else if (r.nick !== info.nick || r.color !== info.color) {
      r.nick = info.nick;
      r.color = info.color;
    }
    return r;
  }

  get(pid) {
    return this.remotes.get(pid) || null;
  }

  // ---------- States ----------

  _onState(msg, from) {
    const pid = this.net.isHost ? from : msg.id || from;
    if (pid === this.net.pid) return;
    const info = this.net.players.get(pid);
    if (!info) return;
    const r = this._ensure(info);
    r.receive(msg, this.net.time);
    // Host: pass it on to the other clients.
    if (this.net.isHost) {
      msg.id = pid;
      this.net.broadcast(msg, { fast: true, except: pid });
    }
  }

  _ownState() {
    const g = this.game;
    const p = g.player;
    let f = 0;
    if (p.onGround) f |= PF.ground;
    if (p.sneaking) f |= PF.sneak;
    if (p.dead) f |= PF.dead;
    if (p.flying) f |= PF.fly;
    if (p.parachute) f |= PF.chute;
    if (p.inWater) f |= PF.water;
    if (p.sprinting) f |= PF.sprint;
    if (p.creative) f |= PF.creative;
    const veh = g.vehicles.active;
    const swing = g.held?.swingProgress ?? 1;
    return {
      t: "ps",
      id: this.net.pid,
      ts: r3(this.net.time),
      p: vec2(p.position),
      v: vec1(p.velocity),
      y: r3(p.yaw),
      pi: r3(p.pitch),
      f,
      h: g.inventory.selectedStack?.id ?? 0,
      sw: swing < 1 ? r2(swing) : 1,
      bw: g.held?.bowDraw > 0 ? r2(g.held.bowDraw) : 0,
      fx: g.held?.shots ?? 0,
      hp: Math.round(p.health + (p.absorption || 0)),
      veh: veh?.net?.nid || 0,
    };
  }

  update(dt) {
    const net = this.net;
    // Our own state, 20 times a second (only once the game is under way).
    this._sendT -= dt;
    if (this._sendT <= 0 && this.mp.stateLoaded && this.game.gameState !== "start") {
      this._sendT = 1 / RATES.player;
      const msg = this._ownState();
      if (net.isHost) net.broadcast(msg, { fast: true });
      else net.toHost(msg, { fast: true });
    }
    const now = net.time;
    for (const r of this.remotes.values()) r.update(dt, now);
  }

  // Every remote player that is in the game (has sent a state).
  *active() {
    for (const r of this.remotes.values()) if (r.seen) yield r;
  }
}

export { HOST_PID };
