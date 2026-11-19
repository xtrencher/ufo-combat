// (Round 21) The colossi online (js/colossi.js). The host simulates them:
// their walk, their attacks, their health, the parasite swarm. Messages (an
// older peer has no handler and ignores them):
//   "colo"   (host to all, ~7 a second while any are about) every colossus,
//            compactly: id, kind, seed (the same model), the root and yaw,
//            the distance walked, the phase and its time, the core's health,
//            every weak point's and plate's state, the attack in progress
//            (its number, time, side, aim, serial), the stumble, the sink;
//            the swarm's positions by slot; `e`: one-offs since the last
//            (the acid globs: each machine flies them and judges its own).
//            A guest draws puppets from it and steps their legs itself from
//            the same root (so the feet land where the host's do).
//   "colhit" (guest to host) the guest's weapon hit part `w` of colossus `c`
//            for `a` (h: heavy; w -2: a blast at p, a its radius; w <= -100:
//            the parasite in slot -100 - w). The host applies it as its own
//            player's hit (the armour rules, the stats, the mission).
//   "colpop" (guest to host) a parasite burst on the guest's aircraft.
// The attacks on players are judged by each machine for its own player and
// aircraft (as the AI's shots are): the swat's hand, the tendrils, the beam,
// the screech's stall, the globs, the parasites.
const STATE_INTERVAL = 0.14;

export class ColossusSync {
  constructor(mp, colossi) {
    this.mp = mp;
    this.net = mp.net;
    this.game = mp.game;
    this.c = colossi;
    this._t = 0;
    this._ev = [];
    this._had = false;
    if (!colossi) return;
    colossi.onSend = (e) => {
      if (this.mp.active && this.net.isHost) this._ev.push(e);
    };
    colossi.onGuestHit = (id, idx, amount, heavy, at) => {
      if (this.mp.active && this.net.isClient) this.net.toHost({ t: "colhit", c: id, w: idx, a: Math.round(amount * 10) / 10, h: heavy ? 1 : 0, ...(at ? { p: at } : {}) });
    };
    colossi.onGuestPop = (slot) => {
      if (this.mp.active && this.net.isClient) this.net.toHost({ t: "colpop", s: slot });
    };
    this.net.on("colo", (m) => {
      if (this.net.isHost || !this.c.puppets) return;
      // (They are the Overworld's: none drawn for a guest in another dimension.)
      if ((this.game.world?.dim ?? "overworld") !== "overworld") {
        if (this.c.list.length) this.c.clear();
        return;
      }
      this.c.applyNet(m);
      for (const e of Array.isArray(m.e) ? m.e.slice(0, 40) : []) this.c.applyEvent(e);
    });
    this.net.on("colhit", (m) => {
      if (!this.net.isHost || !Number.isFinite(m.w) || !Number.isFinite(m.a)) return;
      this.c.applyGuestHit(m.c, m.w, m.a, !!m.h, m.p);
    });
    this.net.on("colpop", (m) => {
      if (this.net.isHost && Number.isFinite(m.s)) this.c.popGuest(m.s);
    });
  }

  start() {
    const c = this.c;
    if (!c) return;
    if (this.net.isHost) {
      c.puppets = false;
      // (The host's colossi go for the guests' aircraft too: their puppets here.)
      const g = this.game;
      c.remoteTargets = () => {
        const out = [];
        for (const v of g.vehicles.vehicles) if (v.puppet && v.netOcc && v.alive) out.push({ ref: v, pos: v.pos, vel: v.vel, air: v.type === "jet" || v.type === "heli" || v.type === "ufo", local: false });
        return out;
      };
    } else {
      c.clear();
      c.puppets = true;
    }
  }

  stop() {
    const c = this.c;
    if (!c) return;
    c.remoteTargets = null;
    if (c.puppets) {
      c.clear();
      c.puppets = false;
    }
  }

  update(dt) {
    const c = this.c;
    if (!c || !this.mp.active || !this.net.isHost) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = STATE_INTERVAL;
    if (!c.list.length && !c.swarm.length && !this._ev.length) {
      if (this._had) {
        this._had = false;
        this.net.broadcast({ t: "colo", l: [], w: [] });
      }
      return;
    }
    this._had = true;
    const s = c.netState();
    s.t = "colo";
    if (this._ev.length) s.e = this._ev.splice(0, 40);
    this.net.broadcast(s);
  }
}
