// Seats online (Round 18): several players in one vehicle. Every shared
// vehicle (net/vehicles.js) has the pilot's (driver's) seat and passengers'
// seats (js/vehicles.js seatCount). The first player in flies it; the others
// ride as passengers in the order they got in. When the pilot gets out (or
// leaves the game, or dies), the passenger who got in first takes the
// controls; when everyone is out it is empty, and the next one in flies it.
//
// The host decides who sits where: a seat table, nid -> { p: the pilot's
// player number (0: nobody), r: the passengers', in the order they got in },
// kept by the host and copied to everyone. A player asks the host ("vsit")
// to get in or out; the host answers everyone with the vehicle's new row
// ("vseats"), or the player alone with why not ("vsitno"). The pilot is
// always the vehicle's owner (net/vehicles.js "vown": it simulates it), so a
// change of pilot moves the vehicle to the new pilot's machine first.
//
// A player's own empty vehicle is boarded at once (no wait for the host),
// and the host told; if someone else was given it a moment before, the host's
// answer puts them in a passenger's seat instead. Every request carries a
// number: a player only lines up with the table once the host has answered
// its newest one (no stale rows: in, out and in again quickly ends right).
//
// Team play (the host's rule, on by default): anyone can get into anyone's
// vehicle. Off: a vehicle someone else flies, or one another player called
// in or summoned, is refused ("Team play is off").
//
// Messages (an older peer has no handler: NET_VERSION 12):
//   "vsit"   { n, on: 1 | 0, q, own? }  get in (on 1; own: already in our own one) or out, to the host
//   "vseats" { n, p, r, a: [pid, q] }   the host: the vehicle's row (a: whose request it answers)
//   "vsitno" { n, why, q }              the host: that request refused
import { HOST_PID } from "./session.js";
import { seatCount } from "../vehicles.js";

export class SeatSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.vm = mp.game.vehicles;
    this.table = new Map(); // nid -> { p, r: [pids] } (the host's word)
    this.seq = 0; // our requests sent
    this.ack = 0; // the newest of them the host has answered
    this.want = null; // { nid, t }: we asked to get into this one
    this.transit = null; // { nid, t }: (space) our seat goes with the craft to its new id (net/space.js)
    this._seqOf = new Map(); // host: pid -> the newest request number
    const net = this.net;
    net.on("vsit", (m, from) => this.net.isHost && this._onSit(m, from));
    net.on("vseats", (m, from) => from === HOST_PID && !this.net.isHost && this._onSeats(m));
    net.on("vsitno", (m, from) => from === HOST_PID && this._onNo(m));
    net.registerSync("seats", {
      save: () => [...this.table].map(([n, e]) => ({ n, p: e.p, r: e.r })),
      load: (list) => {
        if (this.net.isHost || !Array.isArray(list)) return;
        this.table.clear();
        for (const e of list) if (typeof e?.n === "string") this.table.set(e.n, { p: e.p | 0, r: Array.isArray(e.r) ? e.r.map(Number) : [] });
      },
    });
  }

  start() {
    const vm = this.vm;
    vm.pilotName = (v) => {
      const e = v?.net && this.table.get(v.net.nid);
      return e?.p ? this.mp.playerName(e.p) : null;
    };
    vm.boardPrompt = (v) => this._prompt(v);
  }

  stop() {
    this.table.clear();
    this._seqOf.clear();
    this.want = null;
    this.transit = null;
    this.vm.pilotName = null;
    this.vm.boardPrompt = null;
    // (Offline a passenger's seat means nothing: out.)
    if (this.vm.seat > 0 && this.vm.active) this.vm.exit({ force: true });
  }

  get me() {
    return this.net.pid;
  }

  // The row of vehicle v (or of nid), or null.
  rowOf(v) {
    const nid = typeof v === "string" ? v : v?.net?.nid;
    return nid ? this.table.get(nid) || null : null;
  }

  // Who flies v (a player number), 0 if nobody.
  pilotOf(v) {
    return this.rowOf(v)?.p || 0;
  }

  // Someone other than this player sits in v.
  takenByOther(v) {
    const e = this.rowOf(v);
    return !!e && ((e.p && e.p !== this.me) || e.r.some((x) => x !== this.me));
  }

  // The player who called in or summoned v (it is theirs with team play
  // off), 0 if nobody's (or they have left).
  callerOf(v) {
    if (!v?.net || !(v.calledIn || v.summoned)) return 0;
    const pid = Number(String(v.net.nid).split(":")[0]) || 0;
    return pid && (pid === this.me || this.net.players.has(pid)) ? pid : 0;
  }

  // Why player `pid` can't get into v (with row e), or null.
  refusal(v, pid = this.me, e = this.rowOf(v)) {
    if (!v || !v.alive || v.wreck) return "It's a wreck";
    const pilot = e?.p || 0;
    const caller = this.callerOf(v);
    if (this.mp.teamPlay === false && caller !== pid) {
      if (pilot && pilot !== pid) return `Team play is off: you can't get into ${this.mp.playerName(pilot)}'s ${v.name}`;
      if (caller) return `Team play is off: that ${v.name} is ${this.mp.playerName(caller)}'s`;
    }
    if (pilot && pilot !== pid && !e.r.includes(pid) && 1 + e.r.length >= seatCount(v)) return seatCount(v) > 1 ? `The ${v.name} is full` : `${this.mp.playerName(pilot)} is flying it (one seat)`;
    return null;
  }

  _prompt(v) {
    if (!this.mp.active || !v?.net) return null;
    const pilot = this.pilotOf(v);
    const why = (pilot && pilot !== this.me) || this.mp.teamPlay === false ? this.refusal(v) : null;
    if (why) return why;
    if (pilot && pilot !== this.me) return `Press F to ride in ${this.mp.playerName(pilot)}'s ${v.name}`;
    return null;
  }

  // ---------- This player ----------

  _send(m) {
    this.seq++;
    m.q = this.seq;
    if (this.net.isHost) this._onSit(m, this.me);
    else this.net.toHost(m);
  }

  // Asks the host for a seat in v (someone else's, or someone sits in it).
  // Returns the message to show.
  request(v) {
    if (!v?.net) return "Not now";
    const why = this.refusal(v);
    if (why) return why;
    const t = performance.now();
    if (this.want?.nid === v.net.nid && t - this.want.t < 3000) return "Climbing in...";
    this.want = { nid: v.net.nid, t };
    this.mp.vehicles.pendingClaim = { nid: v.net.nid, t }; // (the older name, for the tests)
    this._send({ t: "vsit", n: v.net.nid, on: 1 });
    return "Climbing in...";
  }

  // We got into our own vehicle (at once): the host is told.
  entered(v) {
    if (!v?.net) return;
    this.want = null;
    this._send({ t: "vsit", n: v.net.nid, on: 1, own: 1 });
  }

  // We got out of v (any way: F, death, a portal, the vehicle gone).
  exited(v) {
    if (!v?.net || this.transit) return;
    if (this.want?.nid === v.net.nid) this.want = null;
    this._send({ t: "vsit", n: v.net.nid, on: 0 });
  }

  // ---------- The host ----------

  _onSit(m, from) {
    if (typeof m?.n !== "string" || !from) return;
    const pid = from;
    const q = m.q | 0;
    this._seqOf.set(pid, Math.max(this._seqOf.get(pid) || 0, q));
    const nid = m.n;
    const v = this.mp.vehicles.byNid(nid);
    const e = this.table.get(nid) || { p: 0, r: [] };
    if (m.on) {
      // (One vehicle at a time: out of any other first.)
      for (const [n2, e2] of this.table) if (n2 !== nid && (e2.p === pid || e2.r.includes(pid))) this._drop(n2, pid, [pid, q]);
      if (e.p === pid || e.r.includes(pid)) return this._set(nid, e, [pid, q]);
      const why = this.refusal(v, pid, e);
      if (why) {
        if (pid === this.me) this._onNo({ n: nid, why, q });
        else this.net.send(pid, { t: "vsitno", n: nid, why, q });
        // (Still say who sits there: the asker lines up with it.)
        if (e.p || e.r.length) this._set(nid, e, [pid, q]);
        return;
      }
      if (!e.p) e.p = pid;
      else e.r.push(pid);
      this._set(nid, e, [pid, q]);
    } else this._drop(nid, pid, [pid, q]);
  }

  // Player pid out of vehicle nid (the first passenger takes the controls).
  _drop(nid, pid, a = [0, 0]) {
    const e = this.table.get(nid) || { p: 0, r: [] };
    const v = this.mp.vehicles.byNid(nid);
    if (e.p === pid) e.p = v && v.alive ? e.r.shift() || 0 : 0;
    e.r = e.r.filter((x) => x !== pid);
    if (!e.p) e.r = v && v.alive ? e.r : [];
    if (!e.p && e.r.length) e.p = e.r.shift();
    this._set(nid, e, a);
  }

  // The host's new row for nid: its owner moved to the pilot first, then the
  // row to everyone.
  _set(nid, e, a = [0, 0]) {
    const v = this.mp.vehicles.byNid(nid);
    if (e.p && v?.net && v.net.owner !== e.p) {
      this.mp.vehicles._broadcastOwn(nid, e.p);
      this.mp.vehicles._onOwn({ nid, owner: e.p });
    }
    const msg = { t: "vseats", n: nid, p: e.p | 0, r: e.r.slice(), a };
    this.net.broadcast(msg);
    this._onSeats(msg);
  }

  // A vehicle gone (destroyed, removed): its row with it.
  gone(nid) {
    if (!this.net.isHost || !this.table.has(nid)) return;
    this._set(nid, { p: 0, r: [] });
  }

  // (Space, net/space.js) The craft came down as a new vehicle (prev ->
  // nid): its seats go with it.
  relink(prev, nid) {
    if (!this.net.isHost) return;
    const e = this.table.get(prev);
    if (!e) return;
    this.table.delete(prev);
    this.net.broadcast({ t: "vseats", n: prev, p: 0, r: [], a: [0, 0] });
    this._set(nid, { p: e.p, r: e.r.slice() });
  }

  // A player left the game: out of every seat (a pilot's passengers fly on).
  playerLeft(p) {
    if (!this.net.isHost) return;
    for (const [nid, e] of [...this.table]) if (e.p === p.pid || e.r.includes(p.pid)) this._drop(nid, p.pid);
  }

  // ---------- Everyone: the host's rows ----------

  _onSeats(m) {
    if (typeof m?.n !== "string") return;
    const e = { p: m.p | 0, r: Array.isArray(m.r) ? m.r.map(Number).filter(Boolean) : [] };
    if (!e.p && !e.r.length) this.table.delete(m.n);
    else this.table.set(m.n, e);
    if (Array.isArray(m.a) && m.a[0] === this.me) this.ack = Math.max(this.ack, m.a[1] | 0);
    this._lineUp(m.n);
  }

  _onNo(m) {
    if (Number.isFinite(m.q) && m.q > this.ack) this.ack = m.q;
    if (this.want?.nid === m.n) this.want = null;
    if (this.mp.vehicles.pendingClaim?.nid === m.n) this.mp.vehicles.pendingClaim = null;
    const vm = this.vm;
    // (Our own one we were already in: someone else got it first, and no seat is left.)
    if (vm.active?.net?.nid === m.n) vm.exit();
    if (typeof m.why === "string") this.game.toast?.(m.why.slice(0, 120), 2.5);
  }

  // This player as the host's row for nid says: in the pilot's seat, in a
  // passenger's, or out. Only once our newest request is answered.
  _lineUp(nid) {
    if (this.ack < this.seq) return;
    const vm = this.vm;
    const v = this.mp.vehicles.byNid(nid);
    const e = this.table.get(nid);
    const me = this.me;
    const role = !e ? -1 : e.p === me ? 0 : e.r.includes(me) ? 1 + e.r.indexOf(me) : -1;
    const inIt = !!v && vm.active === v;
    if (role < 0) {
      if (this.want?.nid === nid) this.want = null;
      // (The host took us out: the vehicle is gone, or we were thought gone.)
      if (inIt && !this.transit) vm.exit({ force: !vm.active?.alive });
      return;
    }
    if (inIt) {
      if (role === 0 && vm.seat > 0 && !v.puppet) vm.promote();
      else if (role > 0 && vm.seat === 0) vm.demote(role);
      else if (role > 0) vm.seat = role;
      return;
    }
    if (this.transit) return; // (net/space.js seats us when the craft is down)
    const wanted = this.want?.nid === nid;
    if (!wanted || !v || vm.active || this.game.player.dead || !vm.vehicles.includes(v)) {
      // (Listed, but not in it and not asking: put right.)
      if (!wanted) this.exited(v || { net: { nid } });
      return;
    }
    this.want = null;
    this.mp.vehicles.pendingClaim = null;
    if (role === 0) {
      if (v.puppet) return; // (its owner's change comes first: "vown")
      this.mp.vehicles._seating = true;
      try {
        vm.enter(v);
      } finally {
        this.mp.vehicles._seating = false;
      }
    } else vm.board(v, role);
  }
}
