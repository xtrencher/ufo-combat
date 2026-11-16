// A crew in space together (Round 18). A rocket or a UFO with passengers
// aboard (net/seats.js) takes them into space and to other planets: the
// pilot's machine flies the craft through the solar system (js/solar.js, as
// alone) and is the word on where it is; its passengers' machines draw the
// same craft from that word (solar.js follow / remoteState), each looking
// round as it likes. When the pilot goes down to a planet, every passenger
// travels to the same spot of the same dimension (the dimensions engine, as
// the pilot does) and is seated again in the craft it comes down as there
// (a new vehicle: its "vadd" names the one it was, `prev`, and the host's
// seats move to it, net/seats.js relink). While on the way the passengers
// keep their seats (net/seats.js `transit`: no "out" is sent for them).
// Messages (from the pilot to everyone; only its passengers act on them):
//   "spin"   { n, kind, spins, s }      the craft went into space (s: its state)
//   "sps"    { n, s }                   its state, 10 times a second
//   "spland" { n, body, x, y, z, vel, yaw, pitch }   down to a planet
//   "spend"  { n }                      the trip called off (back to the world at once)
const SEND = 0.1; // seconds between states

export class CrewSpaceSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.vm = mp.game.vehicles;
    this._t = 0;
    const net = this.net;
    net.on("spin", (m, from) => this._onIn(m, from));
    net.on("sps", (m, from) => this._onState(m, from));
    net.on("spland", (m, from) => this._onLand(m, from));
    net.on("spend", (m, from) => this._onEnd(m, from));
  }

  get solar() {
    return this.game.space?.solar || null;
  }

  get seats() {
    return this.mp.seats;
  }

  start() {
    this._hook();
  }

  stop() {
    if (this.seats) this.seats.transit = null;
  }

  _hook() {
    const s = this.solar;
    if (s && s.crew !== this) s.crew = this;
  }

  update() {
    this._hook();
    const s = this.solar;
    const c = s?.craft;
    // (The pilot left in space: the first passenger has the controls now.)
    if (s?.active && c?.remote && !s.pending && this.vm.active === c.v && this.vm.seat === 0 && !c.v.puppet) s.takeControl();
  }

  // Whether this player flies v with passengers aboard.
  hasCrew(v) {
    if (!this.mp.active || !v?.net) return false;
    const row = this.seats?.rowOf(v);
    return !!row && row.p === this.net.pid && row.r.length > 0;
  }

  _mine(m, from) {
    const s = this.solar;
    const v = this.vm.active;
    return !!s && !!v && this.vm.seat > 0 && v.net?.nid === m?.n && v.net.owner === from;
  }

  // ---------- The pilot ----------

  entered(c) {
    if (!this.hasCrew(c.v)) return;
    const s = this.solar;
    this.net.toAll({ t: "spin", n: c.v.net.nid, kind: c.kind, spins: { ...s.spins }, s: s.crewState() });
    this._t = SEND;
  }

  tick(dt, c) {
    this._t -= dt;
    if (this._t > 0 || !this.hasCrew(c.v)) return;
    this._t = SEND;
    this.net.toAll({ t: "sps", n: c.v.net.nid, s: this.solar.crewState() });
  }

  // Down to a planet: the passengers to the same spot; our seats wait for the craft there.
  landing(pd, c) {
    if (!this.hasCrew(c.v)) return;
    const nid = c.v.net.nid;
    this.seats.transit = { nid, t: performance.now() };
    c.v.inTransit = true; // (its "vrem" keeps the seats: net/vehicles.js)
    const r1 = (x) => Math.round(x * 10) / 10;
    this.net.toAll({ t: "spland", n: nid, body: pd.body, x: r1(pd.x), y: r1(pd.y), z: r1(pd.z), vel: pd.vel.map(r1), yaw: pd.yaw, pitch: pd.pitch });
  }

  // Down and in again (the pilot: the new craft; a passenger: seated, or not).
  arrived(v) {
    if (this.seats) this.seats.transit = null;
  }

  ended(c) {
    if (!this.hasCrew(c.v)) return;
    this.net.toAll({ t: "spend", n: c.v.net.nid });
  }

  // ---------- A passenger ----------

  _onIn(m, from) {
    if (!this._mine(m, from) || this.solar.active) return;
    this.solar.follow(this.vm.active, m);
  }

  _onState(m, from) {
    const s = this.solar;
    if (!s?.active || !s.craft?.remote || s.pending || s.craft.v.net?.nid !== m.n) return;
    s.remoteState(m.s);
  }

  _onLand(m, from) {
    const s = this.solar;
    if (!s?.active || !s.craft?.remote || s.pending || s.craft.v.net?.nid !== m.n) return;
    if (![m.x, m.y, m.z].every(Number.isFinite)) return;
    this.seats.transit = { nid: m.n, t: performance.now() };
    // (Its old id is gone: the craft comes down as a new one.)
    this.mp.vehicles.byId.delete(m.n);
    if (!s.remoteLand(m)) this.seats.transit = null;
  }

  _onEnd(m, from) {
    const s = this.solar;
    if (!s?.active || !s.craft?.remote || s.craft.v.net?.nid !== m.n) return;
    s.followEnd();
  }

  // The seat the host gave us in the craft down from space (pd: the landing),
  // once it is here: { v, seat (0: the pilot's) }, or null.
  seatFor(pd) {
    const me = this.net.pid;
    for (const [nid, e] of this.seats.table) {
      const i = e.r.indexOf(me);
      if (i < 0 && e.p !== me) continue;
      const v = this.mp.vehicles.byNid(nid);
      if (!v || v.netPrev !== pd.from || !this.vm.vehicles.includes(v)) continue;
      if (e.p === me) return v.puppet ? null : { v, seat: 0 };
      return { v, seat: i + 1 };
    }
    return null;
  }

  // (Left the pilot's seat while away: in as the pilot.)
  enterOwn(v) {
    const vs = this.mp.vehicles;
    vs._seating = true;
    try {
      this.vm.enter(v);
    } finally {
      vs._seating = false;
    }
  }
}
