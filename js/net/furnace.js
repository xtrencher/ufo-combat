// Furnaces online (Round 11): the host owns every furnace (js/furnace.js),
// like the chests (js/net/chests.js). A guest opening one asks the host
// ("fuopen") and gets what it holds and its bars ("fust"); a click is a small
// change of slots with what each held before ("fuop"), applied by the host
// only if the furnace still holds that (so two players at one furnace, and a
// furnace that smelted meanwhile, stay consistent, in the host's order). The
// host answers the one who asked ("fures": refused, with the whole furnace;
// taken from the output, with the experience) and passes the new slots to
// everyone else who has it open ("fuset"), the bars too: when the fire
// lights or goes out, and once a second while it burns ("fubar"; a guest's
// screen moves them along in between). Closing the screen tells the host
// ("fuclose"). The furnace block, lit or not, is an ordinary block edit
// (js/net/world.js); a broken furnace's contents drop at the host and are
// shared like any dropped item (js/net/items.js). The host smelts in the
// ground it has loaded and near every guest. Older peers ignore these messages.
import { Furnaces, FURNACE_SLOTS, isFurnace, NEAR_GUEST } from "../furnace.js";
import { encodeStack, decodeStack } from "../chests.js";
import { chunkKey, blockIndex } from "../constants.js";

const posOf = (p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isInteger) && p[1] >= 0 && p[1] < 256 ? p : null);
const keyPos = (key) => key.split(",").map(Number);
const BARS_EVERY = 1; // seconds between the bars sent to the screens open on a burning furnace

export class FurnaceSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.furnaces = mp.game.furnaces || null;
    this.watchers = new Map(); // host: furnace key -> Set of the pids that have it open
    this._ops = new Map(); // guest: op number -> done(ok, xp)
    this._n = 1;
    this._barsT = 0;
    if (!this.furnaces) return;
    const fu = this.furnaces;
    // (A guest's page never owns furnaces, not even before its session starts.)
    if (this.game.GUEST) fu.authority = false;
    fu.remote = this;
    fu.onChanged = (key, list) => this._sendSet(key, list);
    fu.onBars = (key) => this._sendBars(key);
    fu.onGone = (key) => this._sendGone(key);
    fu.watched = (key) => this.watchers.has(key);
    fu.nearGuest = (x, z) => this._nearGuest(x, z);
    const net = this.net;
    net.on("fuopen", (m, from) => this._onOpen(m, from));
    net.on("fuclose", (m, from) => this._onClose(m, from));
    net.on("fuop", (m, from) => this._onOp(m, from));
    net.on("fust", (m) => this._onState(m));
    net.on("fuset", (m) => this._onSet(m));
    net.on("fubar", (m) => this._onBars(m));
    net.on("fures", (m) => this._onResult(m));
  }

  start() {
    if (!this.furnaces) return;
    this.furnaces.authority = this.net.isHost;
    // (A guest keeps no furnaces of its own: what it shows comes from the host.)
    if (!this.net.isHost) this.furnaces.store.clear();
  }

  stop() {
    this.watchers.clear();
    for (const done of this._ops.values()) done(false);
    this._ops.clear();
  }

  update(dt) {
    if (!this.furnaces || !this.net.isHost || !this.watchers.size) return;
    this._barsT -= dt;
    if (this._barsT > 0) return;
    this._barsT = BARS_EVERY;
    for (const key of this.watchers.keys()) {
      const b = this.furnaces.bars(key);
      if (b && b[0] > 0) this._sendBars(key);
    }
  }

  playerLeft(p) {
    for (const [key, set] of this.watchers) {
      set.delete(p.pid);
      if (!set.size) this.watchers.delete(key);
    }
  }

  // Host: is a guest near (x, z)? (Its furnaces burn though the host hasn't that ground.)
  _nearGuest(x, z) {
    if (!this.mp.active || !this.net.isHost) return false;
    for (const r of this.mp.players?.active?.() || []) {
      const p = r.position;
      if (p && Math.abs(p.x - x) < NEAR_GUEST && Math.abs(p.z - z) < NEAR_GUEST) return true;
    }
    return false;
  }

  // ---------- A guest: asking the host (js/furnace.js calls these) ----------

  open(view) {
    if (this.mp.active) this.net.toHost({ t: "fuopen", p: [view.x, view.y, view.z] });
  }

  // (A click already sent still settles from the host's "fures": the channel is ordered.)
  close(view) {
    if (this.mp.active) this.net.toHost({ t: "fuclose", p: [view.x, view.y, view.z] });
  }

  op(view, changes, done) {
    if (!this.mp.active) return done(false);
    const n = this._n++;
    this._ops.set(n, done);
    this.net.toHost({ t: "fuop", p: [view.x, view.y, view.z], n, c: changes.map(([i, b, a]) => [i, encodeStack(b), encodeStack(a)]) });
  }

  // ---------- The host ----------

  // Is there a furnace at p? (Ground the host hasn't loaded: a recorded edit must say so.)
  _isFurnaceAt(x, y, z) {
    const world = this.game.world;
    if (world.getChunk(x >> 4, z >> 4)) return isFurnace(world.getBlock(x, y, z));
    return isFurnace(world.edits.get(chunkKey(x >> 4, z >> 4))?.get(blockIndex(x & 15, y, z & 15)));
  }

  _onOpen(m, from) {
    if (!this.net.isHost || !this.furnaces) return;
    const p = posOf(m.p);
    if (!p) return;
    const [x, y, z] = p;
    if (!this._isFurnaceAt(x, y, z)) {
      this.net.send(from, { t: "fust", p, s: 0 });
      return;
    }
    const f = this.furnaces.contents(x, y, z);
    let set = this.watchers.get(f.key);
    if (!set) this.watchers.set(f.key, (set = new Set()));
    set.add(from);
    this.net.send(from, { t: "fust", p, s: f.slots.map(encodeStack), b: this.furnaces.bars(f.key) });
  }

  _onClose(m, from) {
    if (!this.net.isHost) return;
    const p = posOf(m.p);
    if (!p) return;
    const key = Furnaces.key(p[0], p[1], p[2]);
    const set = this.watchers.get(key);
    if (!set) return;
    set.delete(from);
    if (!set.size) this.watchers.delete(key);
  }

  _onOp(m, from) {
    if (!this.net.isHost || !this.furnaces) return;
    const p = posOf(m.p);
    if (!p || !Number.isInteger(m.n)) return;
    const key = Furnaces.key(p[0], p[1], p[2]);
    let r = null;
    if (this.watchers.get(key)?.has(from) && Array.isArray(m.c) && m.c.length <= FURNACE_SLOTS) {
      // (A stack that doesn't decode makes the whole change invalid.)
      const changes = [];
      for (const ch of m.c) {
        if (!Array.isArray(ch)) break;
        const b = decodeStack(ch[1]);
        const a = decodeStack(ch[2]);
        if ((ch[1] && !b) || (ch[2] && !a)) break;
        changes.push([ch[0], b, a]);
      }
      if (changes.length === m.c.length) r = this.furnaces.apply(key, changes, from);
    }
    if (r) this.net.send(from, { t: "fures", p, n: m.n, ok: 1, ...(r.xp > 0 ? { xp: r.xp } : {}) });
    else {
      const f = this.furnaces.store.get(key);
      this.net.send(from, { t: "fures", p, n: m.n, ok: 0, s: f ? f.slots.map(encodeStack) : 0, b: f ? this.furnaces.bars(key) : 0 });
    }
  }

  // Host: slots changed (smelting, anyone's click): to everyone who has it
  // open (the one who clicked too: its screen shows the furnace from these,
  // and they arrive before its answer).
  _sendSet(key, list) {
    if (!this.mp.active || !this.net.isHost) return;
    const set = this.watchers.get(key);
    if (!set || !set.size) return;
    const msg = { t: "fuset", p: keyPos(key), c: list.map(([i, s]) => [i, encodeStack(s)]), b: this.furnaces.bars(key) };
    for (const pid of set) if (pid !== this.net.pid) this.net.send(pid, msg);
  }

  _sendBars(key) {
    if (!this.mp.active || !this.net.isHost) return;
    const set = this.watchers.get(key);
    const b = set?.size ? this.furnaces.bars(key) : null;
    if (!b) return;
    const msg = { t: "fubar", p: keyPos(key), b };
    for (const pid of set) if (pid !== this.net.pid) this.net.send(pid, msg);
  }

  _sendGone(key) {
    const set = this.watchers.get(key);
    this.watchers.delete(key);
    if (!this.mp.active || !this.net.isHost || !set) return;
    const msg = { t: "fust", p: keyPos(key), s: 0 };
    for (const pid of set) if (pid !== this.net.pid) this.net.send(pid, msg);
  }

  // ---------- A guest: the host's answers ----------

  _slotsOf(s) {
    if (!Array.isArray(s) || s.length !== FURNACE_SLOTS) return null;
    return s.map((e) => decodeStack(e));
  }

  _onState(m) {
    if (this.net.isHost || !this.furnaces) return;
    const p = posOf(m.p);
    if (p) this.furnaces.remoteState(Furnaces.key(p[0], p[1], p[2]), this._slotsOf(m.s), m.b);
  }

  _onSet(m) {
    if (this.net.isHost || !this.furnaces) return;
    const p = posOf(m.p);
    if (!p || !Array.isArray(m.c) || m.c.length > FURNACE_SLOTS) return;
    const list = [];
    for (const ch of m.c) if (Array.isArray(ch) && Number.isInteger(ch[0])) list.push([ch[0], decodeStack(ch[1])]);
    this.furnaces.remoteSet(Furnaces.key(p[0], p[1], p[2]), list, m.b);
  }

  _onBars(m) {
    if (this.net.isHost || !this.furnaces) return;
    const p = posOf(m.p);
    if (p) this.furnaces.remoteBars(Furnaces.key(p[0], p[1], p[2]), m.b);
  }

  _onResult(m) {
    if (this.net.isHost || !this.furnaces) return;
    const done = this._ops.get(m.n);
    this._ops.delete(m.n);
    const p = posOf(m.p);
    // (Refused: the furnace as it is now, or gone.)
    if (!m.ok && p && m.s !== undefined) this.furnaces.remoteState(Furnaces.key(p[0], p[1], p[2]), this._slotsOf(m.s), m.b);
    const xp = Number.isInteger(m.xp) && m.xp > 0 && m.xp < 100000 ? m.xp : 0;
    done?.(!!m.ok, xp);
  }
}
