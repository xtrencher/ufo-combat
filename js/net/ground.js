// (Round 13) The ground war online (js/tanks.js, js/vehicle-tank.js,
// js/ballistic.js). The tanks, AA vehicles and launchers themselves are
// shared vehicles (net/vehicles.js: the owner drives, the others draw a
// puppet from its states, which carry the hull, the turret, the gun, the
// erector); the host runs the aliens' and their AI fights every player
// (the AI's targets: net/entities.js). This module adds what those states
// don't carry. Messages (an older peer has no handler and ignores them):
//   "gfire" { n, k, p, v, q }  a shot: n the vehicle's shared id, k "shell"
//                              (p the muzzle, v the shell's velocity: the
//                              others fly a shell of their own, drawn only;
//                              the owner's blast reaches everyone as an
//                              explosion) or "flak" (q the bursts' points)
//   "gbm"   { i, s, e, h, b }  a ballistic missile away: from s to e over
//                              an arc of height h (every peer flies the same
//                              path; the owner's warhead is the real one)
//   "gkill" { k, at }          (host to a guest) the guest's shot destroyed
//                              one of the aliens' vehicles: their stats, the
//                              callout, the notice
import * as THREE from "three";
import { shellsOf } from "../vehicle-tank.js";
import { flakBursts } from "../tanks.js";

const r2 = (v) => Math.round(v * 100) / 100;
const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
const vec = (a) => (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? new THREE.Vector3(a[0], a[1], a[2]) : null);
const KILL_STATS = { enemytank: ["tanksDown"], aa: ["aaDown"], enemytel: ["telsDown"] };

export class GroundSync {
  constructor(mp, war) {
    this.mp = mp;
    this.net = mp.net;
    this.game = mp.game;
    this.war = war;
    if (!war) return;
    const veh = war.vehicles;
    // This peer's shots, launches; a guest's kills (the host).
    veh.onGroundFire = (v, kind, from, vel, extra) => {
      if (!this.mp.active || !this.mp.stateLoaded || v.puppet) return;
      const msg = { t: "gfire", n: v.net?.nid || 0, k: kind, p: v3(from) };
      if (vel) msg.v = v3(vel);
      if (kind === "flak" && Array.isArray(extra)) msg.q = extra.slice(0, 6).map(v3);
      this.net.toAll(msg);
    };
    war.ballistics.onLaunch = (m) => {
      if (!this.mp.active || !this.mp.stateLoaded) return;
      this.net.toAll({ t: "gbm", i: m.id, s: v3(m.S), e: v3(m.T), h: Math.round(m.H) });
    };
    war.onRemoteKill = (pid, u) => {
      if (this.mp.active && this.net.isHost) this.net.send(pid, { t: "gkill", k: u.type, at: v3(u.pos) });
    };
    this.net.on("gfire", (m, from) => this._onFire(m, from));
    this.net.on("gbm", (m, from) => this._onBallistic(m, from));
    this.net.on("gkill", (m, from) => this._onKill(m, from));
  }

  start() {
    const w = this.war;
    if (!w) return;
    w.vehicles.localPid = this.net.pid || 1;
    if (this.net.isHost) {
      w.puppets = false;
      w.targets = () => this.mp.entities.targets();
    } else {
      // A guest: the host's units come as puppets; its own go.
      w.puppets = true;
      w.targets = null;
      for (const u of w.units) w.vehicles.remove(u);
    }
  }

  stop() {
    const w = this.war;
    if (!w) return;
    w.puppets = false;
    w.targets = null;
    w.enabled = true;
    w.vehicles.localPid = 1;
  }

  update() {
    // (A Dogfight has no ground war.)
    if (this.war) this.war.enabled = this.mp.mode !== "dogfight";
  }

  _onFire(m, from) {
    if (!this.mp.stateLoaded || typeof m.k !== "string") return;
    const p = vec(m.p);
    if (!p) return;
    const v = m.n ? this.mp.vehicles.byNid(m.n) : null;
    if (m.k === "shell") {
      const vel = vec(m.v);
      if (!vel || vel.length() > 2000) return;
      if (v?.netFire) v.netFire("shell", p, vel);
      else shellsOf(this.war.vehicles).fire({ pos: p, vel, remote: true });
    } else if (m.k === "flak" && Array.isArray(m.q)) {
      const pts = m.q.slice(0, 6).map(vec).filter(Boolean);
      if (pts.length) flakBursts(this.war.vehicles, pts, 0.4);
      v?.netFire?.("flak", p); // (Round 14: the AA puppet's barrels fire by turns)
    }
  }

  _onBallistic(m, from) {
    if (!this.mp.stateLoaded) return;
    const S = vec(m.s);
    const T = vec(m.e);
    if (!S || !T || !Number.isFinite(m.h)) return;
    this.war.ballistics.launch({ S, T, H: Math.max(50, Math.min(1200, m.h)), remote: true, id: m.i, by: from });
  }

  // (A guest) the host says our shot destroyed one of the aliens' vehicles.
  _onKill(m, from) {
    if (this.net.isHost || typeof m.k !== "string") return;
    const g = this.game;
    for (const k of [...(KILL_STATS[m.k] || []), "groundDown"]) g.stats?.add?.(k);
    g.toast?.(m.k === "enemytel" ? "LAUNCHER DESTROYED!" : m.k === "aa" ? "AA VEHICLE DESTROYED!" : "TANK DESTROYED!", 2.5); // (the callout: the stats, voice.js)
  }
}
