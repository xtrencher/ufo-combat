// Supply crates online (Round 8): one shared set of crates, the host's.
// The host drops them (one per player when crates come: each near its
// player, and the supply mission's), every peer sees the same crate fall on
// the same path (the fall is computed from its drop point, so only the drop
// travels), and the first player to reach one opens it: a guest asks the
// host ("copen"), the host gives it to the first who asked and tells
// everyone ("cgone"). The one who opens it rolls its loot (their own tier
// and what they have). An expired crate goes for everyone at once.
import { HOST_PID } from "./session.js";

const r1 = (v) => Math.round(v * 10) / 10;

export class CrateSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this._hooked = false;
    const net = this.net;
    net.on("cdrop", (m) => this._onDrop(m));
    net.on("copen", (m, from) => this._onOpenRequest(m, from));
    net.on("cgone", (m) => this._onGone(m));
    net.registerSync("crates", {
      save: () => this.game.crates.active.map((c) => this._info(c)),
      load: (list) => {
        for (const m of list || []) this._onDrop(m);
      },
    });
  }

  start() {
    const c = this.game.crates;
    if (!this._hooked) this._hook();
    if (this.net.isHost) {
      c.targets = () => this.mp.entities.targets();
      c.spawning = true;
    } else {
      c.spawning = false;
      c.clear();
    }
  }

  stop() {
    const c = this.game.crates;
    c.targets = null;
    c.spawning = true;
    // (A guest's copies of the host's crates go with the session.)
    if (!this.net.isHost) c.clear();
  }

  _info(c) {
    return { id: c.id, x: r1(c.x), z: r1(c.z), y: r1(c.y0), sway: Math.round(c.sway * 1000) / 1000, age: r1(c.age) };
  }

  _hook() {
    this._hooked = true;
    const crates = this.game.crates;
    crates.onDropped = (c) => {
      if (this.mp.active && this.net.isHost) this.net.broadcast({ t: "cdrop", ...this._info(c) });
    };
    crates.onExpired = (c) => {
      if (this.mp.active && this.net.isHost) this.net.broadcast({ t: "cgone", id: c.id, by: 0 });
    };
    crates.canOpen = (c) => {
      if (!this.mp.active) return true;
      if (this.net.isHost) {
        this.net.broadcast({ t: "cgone", id: c.id, by: HOST_PID });
        return true;
      }
      // Ask the host; the crate stays shut until it answers.
      const now = performance.now();
      if (c.asked && now - c.asked < 1500) return false;
      c.asked = now;
      this.net.toHost({ t: "copen", id: c.id });
      return false;
    };
    const clear = crates.clear.bind(crates);
    crates.clear = () => {
      if (this.mp.active && this.net.isHost) for (const c of crates.active) this.net.broadcast({ t: "cgone", id: c.id, by: 0 });
      clear();
    };
  }

  _onDrop(m) {
    if (this.net.isHost || !m || !Number.isFinite(m.id)) return;
    const crates = this.game.crates;
    if (crates.byId(m.id)) return;
    const c = crates.drop({ net: { id: m.id, x: m.x, z: m.z, y: m.y, sway: m.sway, age: m.age || 0 } });
    if (c) c.remote = true;
  }

  // Host: the first who asks gets it.
  _onOpenRequest(m, from) {
    if (!this.net.isHost) return;
    const c = this.game.crates.byId(m.id);
    if (!c || c.state !== "landed") return;
    c.state = "gone";
    const msg = { t: "cgone", id: c.id, by: from };
    this.net.broadcast(msg);
  }

  _onGone(m) {
    if (this.net.isHost) return;
    const crates = this.game.crates;
    const c = crates.byId(m.id);
    if (!c || c.state === "gone") return;
    if (m.by === this.net.pid) crates.open(c);
    else crates.remove(m.id);
  }
}
