// Boats and minecarts online (Round 12, js/boats.js). The host keeps every
// vehicle and saves them; a joining player gets them all ("transport").
// Each is run by one peer, its driver's (the first rider, a player), else
// the one running its dimension's world (the host in its own): that peer
// sends its states, the host passes them on, everyone else draws it from
// them (net/interp.js). Riding, hitting and placing are asked of the host,
// which tells everyone who sits where; a chest boat's or a chest minecart's
// contents are the host's, a guest's clicks asked of it (as chests').
// Messages (older peers have no handler and ignore them):
//   "tvs"    { ts, s: [[id, x, y, z, vx, vy, vz, yaw, pitch, oars], ...] }   states (fast)
//   "tvadd"  { r }            a vehicle put down (guest -> host -> everyone)
//   "tvrem"  { i, f? }        gone (host; f: a fallen boat's fall, its riders take it)
//   "tvr"    { i, r }         its riders (host): [[1, pid] | [2, creature id], ...]
//   "tvride" { i } / "tvoff" { i }    a guest gets in / out (to the host)
//   "tvhit"  { i, d, c }      a guest's blow (to the host); "tvhurt" { i, h } the rocking (host)
//   "tvbreak" { i, pl, f }    lava or a fall broke the one a guest runs (to the host)
//   "tcopen" / "tcclose" { i }, "tcinv" { i, s }, "tcop" { i, q, ch }, "tcans" { q, ok }, "tcset" { i, l }
//                             a vehicle's chest (as js/net/chests.js)
import { Interp, r2, r3 } from "./interp.js";
import { HOST_PID } from "./session.js";
import { encodeStack, decodeStack } from "../inventory.js";
import { sitPose, MAX_VEHICLES, CHEST_SLOTS } from "../boats.js";

const IDLE = 1; // s between the states of one at rest
const MOVING = 0.05;
const NEAR = 10; // blocks: how near a guest must be to what it asks about

export class TransportSync {
  constructor(mp, transport) {
    this.mp = mp;
    this.net = mp.net;
    this.T = transport;
    if (!transport) return;
    transport.remote = this;
    this._seat = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
    const on = (t, fn) => this.net.on(t, (m, from) => {
      if (m && typeof m === "object") fn(m, from);
    });
    on("tvs", (m, from) => this._onStates(m, from));
    on("tvadd", (m, from) => this._onAdd(m, from));
    on("tvrem", (m, from) => from === HOST_PID && !this.net.isHost && this.T.removedRemote(m.i, Number(m.f) || 0));
    on("tvr", (m, from) => this._onRiders(m, from));
    on("tvride", (m, from) => this._onRide(m, from));
    on("tvoff", (m, from) => this._onOff(m, from));
    on("tvhit", (m, from) => this._onHit(m, from));
    on("tvhurt", (m, from) => {
      const v = from === HOST_PID && this.T.vehicles.get(m.i);
      if (v && !this.net.isHost) this.T.wobble(v, m.h === -1 ? -1 : 1);
    });
    on("tvbreak", (m, from) => this._onBreak(m, from));
    on("tcopen", (m, from) => this._onChestOpen(m, from));
    on("tcclose", () => {});
    on("tcinv", (m, from) => {
      if (from !== HOST_PID || this.net.isHost) return;
      this.T.chestState(m.i, Array.isArray(m.s) ? Array.from({ length: CHEST_SLOTS }, (_, i) => decodeStack(m.s[i] ?? 0) || null) : null);
    });
    on("tcop", (m, from) => this._onChestOp(m, from));
    on("tcans", (m, from) => from === HOST_PID && this.T.chestAnswer(m.q, m.ok));
    on("tcset", (m, from) => {
      if (from !== HOST_PID || this.net.isHost || !Array.isArray(m.l)) return;
      this.T.chestSet(m.i, m.l.filter(Array.isArray).map(([i, s]) => [i, decodeStack(s ?? 0) || null]));
    });
    this.net.registerSync("transport", {
      save: () => [...this.T.vehicles.values()].map((v) => ({ ...this.T.record(v), r: this.T.writeRiders(v) })),
      load: (list) => {
        if (this.net.isHost) return;
        this.T.clear();
        for (const r of Array.isArray(list) ? list.slice(0, MAX_VEHICLES) : []) this.T.make(r);
      },
    });
  }

  get active() {
    return !!this.T && this.mp.active;
  }

  start() {
    if (!this.T) return;
    this.T.authority = this.net.isHost;
    // (A guest keeps none of its own: they come with the host's state.)
    if (!this.net.isHost) this.T.clear();
  }

  stop() {
    if (!this.T) return;
    // (The host plays on alone: the guests' seats are empty now.)
    for (const v of this.T.vehicles.values()) {
      const n = v.riders.length;
      v.riders = v.riders.filter((e) => !e.p || e.p === this.T.me || e.p === HOST_PID);
      if (v.riders.length !== n) v.rest = 0;
      v.interp = null;
    }
    this.T.authority = true;
  }

  playerLeft(p) {
    if (!this.T || !this.net.isHost) return;
    for (const v of this.T.vehicles.values()) {
      const i = v.riders.findIndex((e) => e.p === p.pid);
      if (i < 0) continue;
      v.riders.splice(i, 1);
      this.ridersChanged(v);
    }
  }

  // Who runs `v` (the host's view): its driver, else the one running its dimension.
  simulator(v) {
    const d = v.riders[0];
    if (d?.p) return d.p;
    if ((this.net.players.get(HOST_PID)?.dim | 0) === v.dim) return HOST_PID;
    let best = 0;
    for (const p of this.net.players.values()) if ((p.dim | 0) === v.dim && (!best || p.pid < best)) best = p.pid;
    return best;
  }

  _near(pid, x, y, z, r = NEAR) {
    const pl = this.mp.players?.get(pid);
    const at = pl?.livePos;
    return !!at && Math.abs(at.x - x) <= r && Math.abs(at.y - y) <= r && Math.abs(at.z - z) <= r;
  }

  // ---------- Transport's calls ----------

  added(v) {
    if (!this.active) return;
    const msg = { t: "tvadd", r: { ...this.T.record(v), r: this.T.writeRiders(v) } };
    if (this.net.isHost) this.net.broadcast(msg);
    else this.net.toHost(msg);
  }

  gone(v, fall = 0) {
    if (this.active && this.net.isHost) this.net.broadcast({ t: "tvrem", i: v.id, ...(fall ? { f: r2(fall) } : {}) });
  }

  ridersChanged(v) {
    if (this.active && this.net.isHost) this.net.broadcast({ t: "tvr", i: v.id, r: this.T.writeRiders(v) });
  }

  ride(v) {
    if (this.active) this.net.toHost({ t: "tvride", i: v.id });
  }

  left(v) {
    if (!this.active) return;
    if (this.net.isHost) this.ridersChanged(v);
    else this.net.toHost({ t: "tvoff", i: v.id });
  }

  hit(v, amount, creative) {
    if (this.active) this.net.toHost({ t: "tvhit", i: v.id, d: r2(amount), c: creative ? 1 : 0 });
  }

  hurt(v) {
    if (this.active && this.net.isHost) this.net.broadcast({ t: "tvhurt", i: v.id, h: v.hurtDir });
  }

  destroyed(v, { planks = false, fall = 0 } = {}) {
    if (this.active) this.net.toHost({ t: "tvbreak", i: v.id, pl: planks ? 1 : 0, f: r2(fall) });
  }

  openChest(v) {
    if (this.active) this.net.toHost({ t: "tcopen", i: v.id });
  }

  closeChest(v) {
    if (this.active && !this.net.isHost) this.net.toHost({ t: "tcclose", i: v.id });
  }

  chestOp(v, q, changes) {
    if (!this.active) return this.T.chestAnswer(q, false);
    this.net.toHost({ t: "tcop", i: v.id, q, ch: changes.map(([i, b, a]) => [i, encodeStack(b), encodeStack(a)]) });
  }

  chestChanged(v, next) {
    if (this.active && this.net.isHost) this.net.broadcast({ t: "tcset", i: v.id, l: next.map(([i, s]) => [i, encodeStack(s)]) });
  }

  // ---------- Every frame ----------

  update(dt) {
    if (!this.active) return;
    const T = this.T;
    const out = [];
    for (const v of T.vehicles.values()) {
      if (!T.simulates(v)) continue;
      const moving = v.vel.lengthSq() > 1e-7 || v.rowing || v.hurtTime > 0;
      v.sentT -= dt;
      if (v.sentT > 0 && !(moving && v.sentT > MOVING && v.wasIdle)) continue;
      v.sentT = moving ? MOVING : IDLE;
      v.wasIdle = !moving;
      out.push([v.id, r3(v.pos.x), r3(v.pos.y), r3(v.pos.z), r2(v.vel.x * 20), r2(v.vel.y * 20), r2(v.vel.z * 20), r3(v.yaw), r2(v.pitch), v.rowing | 0]);
    }
    if (out.length) {
      const msg = { t: "tvs", ts: r3(this.net.time), s: out };
      if (this.net.isHost) this.net.broadcast(msg, { fast: true });
      else this.net.toHost(msg, { fast: true });
    }
    // The other players riding: seated in this peer's copy, in the riding pose.
    const here = T.here;
    for (const v of T.vehicles.values()) {
      if (v.dim !== here || !v.riders.length || !v.model) continue;
      for (let i = 0; i < v.riders.length; i++) {
        const pid = v.riders[i].p;
        if (!pid || pid === T.me) continue;
        const r = this.mp.players?.get(pid);
        if (!r?.seen || !r.avatar?.root.visible) continue;
        const s = T.seatPos(v, i, false, this._seat);
        r.avatar.root.position.set(s.x, s.y, s.z);
        sitPose(r.avatar);
      }
    }
  }

  // ---------- Received ----------

  _onStates(m, from) {
    if (!Array.isArray(m.s) || !Number.isFinite(m.ts)) return;
    const T = this.T;
    const host = this.net.isHost;
    if (!host && from !== HOST_PID) return;
    const now = this.net.time;
    const pass = [];
    for (const e of m.s) {
      if (!Array.isArray(e) || e.length < 10 || !e.slice(1, 9).every(Number.isFinite)) continue;
      const v = T.vehicles.get(e[0]);
      if (!v) continue;
      // (the host: only from the one running it)
      if (host && this.simulator(v) !== from) continue;
      if (host) pass.push(e);
      if (T.simulates(v)) continue;
      v.interp ||= new Interp({ angles: ["y"], snap: 12 });
      v.interp.push({ ts: m.ts, p: [e[1], e[2], e[3]], v: [e[4], e[5], e[6]], y: e[7], pi: e[8], f: e[9] | 0 }, now);
      v.rest = 0;
    }
    if (host && pass.length) this.net.broadcast({ t: "tvs", ts: m.ts, s: pass }, { fast: true, except: from });
  }

  _onAdd(m, from) {
    const r = m.r;
    if (!r || typeof r !== "object" || !Array.isArray(r.p)) return;
    const T = this.T;
    if (this.net.isHost) {
      if (T.vehicles.has(r.i) || !Number.isInteger(r.i)) return;
      if (T.vehicles.size >= MAX_VEHICLES || !this._near(from, r.p[0], r.p[1], r.p[2])) {
        this.net.send(from, { t: "tvrem", i: r.i });
        return;
      }
      const v = T.make({ ...r, r: undefined, s: undefined });
      if (v) this.net.broadcast({ t: "tvadd", r: T.record(v) }, { except: from });
    } else if (from === HOST_PID && !T.vehicles.has(r.i)) T.make(r);
  }

  _onRiders(m, from) {
    if (from !== HOST_PID || this.net.isHost) return;
    const v = this.T.vehicles.get(m.i);
    if (!v) return;
    const before = this.T.simulates(v);
    this.T.setRiders(v, m.r);
    if (before !== this.T.simulates(v)) v.interp = null;
  }

  _onRide(m, from) {
    const T = this.T;
    if (!this.net.isHost) return;
    const v = T.vehicles.get(m.i);
    if (!v) return;
    const busy = [...T.vehicles.values()].some((o) => o.riders.some((e) => e.p === from));
    if (!busy && v.riders.length < T.seats(v) && this._near(from, v.pos.x, v.pos.y, v.pos.z, 7)) {
      v.riders.push({ p: from });
      v.rest = 0;
      v.interp = null;
    }
    this.net.broadcast({ t: "tvr", i: v.id, r: T.writeRiders(v) });
  }

  _onOff(m, from) {
    if (!this.net.isHost) return;
    const v = this.T.vehicles.get(m.i);
    if (!v) return;
    const i = v.riders.findIndex((e) => e.p === from);
    if (i < 0) return;
    v.riders.splice(i, 1);
    v.rest = 0;
    this.ridersChanged(v);
  }

  _onHit(m, from) {
    const T = this.T;
    if (!this.net.isHost || !Number.isFinite(m.d)) return;
    const v = T.vehicles.get(m.i);
    if (!v || !this._near(from, v.pos.x, v.pos.y, v.pos.z, 8)) return;
    const creative = !!m.c && !!this.mp.players?.get(from)?.creative;
    T.hit(v, Math.max(0, Math.min(50, m.d)), creative);
  }

  _onBreak(m, from) {
    if (!this.net.isHost) return;
    const v = this.T.vehicles.get(m.i);
    if (!v || this.simulator(v) !== from) return;
    this.T.destroy(v, { drop: false, planks: !!m.pl, fall: Number(m.f) || 0 });
  }

  _onChestOpen(m, from) {
    if (!this.net.isHost) return;
    const v = this.T.vehicles.get(m.i);
    if (!v?.chest || !this._near(from, v.pos.x, v.pos.y, v.pos.z)) {
      this.net.send(from, { t: "tcinv", i: m.i, s: null });
      return;
    }
    v.slots ||= new Array(CHEST_SLOTS).fill(null);
    this.net.send(from, { t: "tcinv", i: v.id, s: v.slots.map((s) => encodeStack(s)) });
  }

  _onChestOp(m, from) {
    if (!this.net.isHost || !Array.isArray(m.ch)) return;
    const v = this.T.vehicles.get(m.i);
    const ok = !!v && this._near(from, v.pos.x, v.pos.y, v.pos.z) && this.T.applyChest(m.i, m.ch.filter(Array.isArray).map(([i, b, a]) => [i, decodeStack(b ?? 0) || null, decodeStack(a ?? 0) || null]), from);
    this.net.send(from, { t: "tcans", q: m.q, ok: ok ? 1 : 0 });
  }
}
