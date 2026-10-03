// Player versus player (Round 8). Players can hurt each other with every
// weapon: bullets, bolts, arrows, the rail, swords and fists, and (judged by
// the victim, like before) explosions. The host decides with its
// "PvP / friendly fire" rule (default on), for co-op as well; a Dogfight is
// always PvP.
//
// Like every direct shot online, a hit is the shooter's call ("favour the
// shooter"): the shooter tests its shots against the other players as they
// are drawn on its screen, and the hit goes to the victim ("pvp"), whose own
// armour, difficulty and creative mode apply there. The victim's death names
// the killer ("Killed by Bob"), and the killer is told ("pkill").
//
// How it plugs in: the other players on foot are handed to the creature
// system as stand-ins (`isRemotePlayer`), so every weapon that already hits
// creatures (the sniper, the machine gun, arrows, the rail, melee) hits
// players too; bolts (the pistol, the blaster, the minigun, the UFO cannon)
// get a hit provider of their own.
import * as THREE from "three";
import { r1, r2 } from "./interp.js";

const BODY_R = 0.34;
const BODY_H = 1.85;
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

// Slab test: distance along the ray to the box, or null.
function rayBox(o, d, min, max, reach) {
  let t0 = 0;
  let t1 = reach;
  for (const k of ["x", "y", "z"]) {
    const inv = 1 / (d[k] || 1e-9);
    let a = (min[k] - o[k]) * inv;
    let b = (max[k] - o[k]) * inv;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t1 < t0) return null;
  }
  return t0;
}

export class PvpSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.stand = new Map(); // pid -> stand-in for the creature system
    this._hooked = false;
    this.net.on("pvp", (m, from) => this._onHit(m, from));
    this.net.on("pkill", (m, from) => this._onKill(m, from));
  }

  // May players hurt each other right now?
  get allowed() {
    const mp = this.mp;
    if (!mp.active) return false;
    if (mp.mode === "dogfight") return !mp.dogfight?.watching;
    return mp.pvp !== false;
  }

  start() {
    if (!this._hooked) this._hook();
  }

  stop() {
    this.stand.clear();
  }

  playerLeft(p) {
    this.stand.delete(p.pid);
  }

  update() {
    // (Lock-on and the jets' guns on other players' aircraft follow the rule.)
    if (this.mp.active) this.game.vehicles.pvp = this.allowed;
  }

  // The other players on foot that can be hit now.
  *_targets() {
    if (!this.allowed) return;
    for (const r of this.mp.players.active()) {
      if (r.dead || r.vehicle || r.vehicleNid || r.creative) continue;
      let s = this.stand.get(r.pid);
      if (!s) {
        s = { isRemotePlayer: true, pid: r.pid, kind: "player", pos: new THREE.Vector3(), vel: new THREE.Vector3(), spec: { r: BODY_R, h: BODY_H, hostile: false, drops: [] }, dead: false, health: 20, maxHealth: 20, invulnerable: 0, hurtTime: 9 };
        this.stand.set(r.pid, s);
      }
      s.pos.copy(r.position);
      s.vel.copy(r.velocity);
      yield s;
    }
  }

  _hook() {
    this._hooked = true;
    const g = this.game;
    const mobs = g.mobs;
    // Creature raycasts see the other players too.
    const raycast = mobs.raycast.bind(mobs);
    mobs.raycast = (origin, dir, reach, filter = null) => {
      let best = raycast(origin, dir, reach, filter);
      if (!this.mp.active) return best;
      for (const s of this._targets()) {
        if (filter && !filter(s)) continue;
        _min.set(s.pos.x - BODY_R, s.pos.y, s.pos.z - BODY_R);
        _max.set(s.pos.x + BODY_R, s.pos.y + BODY_H, s.pos.z + BODY_R);
        const t = rayBox(origin, dir, _min, _max, best ? best.distance : reach);
        if (t !== null && (!best || t < best.distance)) best = { mob: s, distance: t };
      }
      return best;
    };
    // (Round 9) The stand-ins for area weapons (the UFO superweapon's beam).
    mobs.standIns = () => (this.mp.active ? [...this._targets()] : []);
    // A hit on a stand-in: the damage goes to that player.
    const hurt = mobs._hurt.bind(mobs);
    mobs._hurt = (m, amount, dir, kb, byPlayer = false) => {
      if (!m?.isRemotePlayer) return hurt(m, amount, dir, kb, byPlayer);
      if (!byPlayer || amount <= 0 || !this.allowed) return false;
      this.hit(m.pid, amount, "pk", dir ? [dir.x * kb, dir.z * kb] : null);
      return true;
    };
    // Bolts (pistol, blaster, minigun, UFO cannon) fired here hit the other players.
    g.lasers.addProvider({
      ignores: (b) => b.mirror || !(b.owner === "player" || b.owner === "playerufo" || b.owner === "jet"),
      raycast: (origin, dir, maxDist, bolt) => {
        let best = null;
        const pad = (bolt.radius ?? 0.05) * 1.5;
        for (const s of this._targets()) {
          _min.set(s.pos.x - BODY_R - pad, s.pos.y - pad, s.pos.z - BODY_R - pad);
          _max.set(s.pos.x + BODY_R + pad, s.pos.y + BODY_H + pad, s.pos.z + BODY_R + pad);
          const t = rayBox(origin, dir, _min, _max, Math.max(maxDist, bolt.step ?? maxDist));
          if (t !== null && t <= maxDist && (!best || t < best.distance)) best = { s, distance: t };
        }
        if (!best) return null;
        const pid = best.s.pid;
        return { distance: best.distance, hit: (b, point, d) => this.hit(pid, b.damage, "pk", d ? [d.x * 3, d.z * 3] : null, point) };
      },
    });
  }

  // This player hit player `pid`.
  hit(pid, amount, cause = "pk", push = null, point = null) {
    if (!this.allowed) return;
    const me = this.game.player;
    const from = point || me.getEyePosition();
    this.net.toPlayer(pid, { t: "pvp", a: r1(amount), c: cause, k: push ? [r2(push[0]), r2(push[1])] : 0, f: [r1(from.x), r1(from.y), r1(from.z)] });
    this.game.hud?.hitMarker?.();
    const s = this.stand.get(pid);
    if (s) s.hurtTime = 0;
  }

  // Another player hit this one (their call).
  _onHit(m, from) {
    const g = this.game;
    if (!this.allowed || !from || from === this.net.pid) return;
    const p = g.player;
    if (p.dead || g.vehicles.active) return;
    const amount = Math.max(0, Math.min(200, Number(m.a) || 0));
    const at = Array.isArray(m.f) ? new THREE.Vector3(m.f[0], m.f[1], m.f[2]) : null;
    const cause = `pk@${from}`;
    if (p.damage(amount, cause, { projectile: true, from: at }) && Array.isArray(m.k)) {
      p.applyImpulse(new THREE.Vector3(m.k[0], 1.5, m.k[1]));
    }
  }

  // This player died: a player who killed them hears of it.
  died(cause) {
    const m = typeof cause === "string" ? /@(\d+)/.exec(cause) : null;
    const pid = m ? Number(m[1]) : 0;
    if (pid && pid !== this.net.pid && this.net.players.has(pid)) this.net.toPlayer(pid, { t: "pkill" });
  }

  _onKill(m, from) {
    const g = this.game;
    g.stats?.add?.("playerKills");
    if (this.mp.mode !== "dogfight") g.toast?.(`You took down ${this.mp.playerName(from)}`, 2.5);
  }
}
