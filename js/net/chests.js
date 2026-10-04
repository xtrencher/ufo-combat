// Chests online (Round 10): the host owns every chest's contents
// (js/chests.js). A guest opening one asks the host ("chopen"); the host
// rolls it if nobody opened it before and answers with what it holds
// ("chst"). A guest's click is a small change of slots, with what each slot
// held before ("chop"): the host applies it only if the chest still holds
// that, so two players with the same chest open stay consistent, in the
// host's order. The host passes the new slots to everyone who has that
// chest open ("chset") and answers the one who asked ("chres"; refused: with
// the whole chest, and their own items stay where they were). Closing the
// screen tells the host ("chclose").
//
// The chest block itself is an ordinary block edit (js/net/world.js); the
// host drops a broken chest's contents, and dropped items are shared
// (js/net/items.js). Older peers don't know these messages and ignore them.
import { Chests, encodeStack, decodeStack, CHEST_SLOTS } from "../chests.js";
import { IS_CHEST } from "../blocks.js";
import { chunkKey, blockIndex } from "../constants.js";

const posOf = (p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isInteger) && p[1] >= 0 && p[1] < 256 ? p : null);
const keyPos = (key) => key.split(",").map(Number);

export class ChestSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.chests = mp.game.interaction?.chests || null;
    this.watchers = new Map(); // host: chest key -> Set of the pids that have it open
    this._ops = new Map(); // guest: op number -> done(ok)
    this._n = 1;
    if (!this.chests) return;
    const chests = this.chests;
    // (A guest's page never owns chests, not even before its session starts.)
    if (this.game.GUEST) chests.authority = false;
    chests.remote = this;
    chests.onChanged = (key, list) => this._sendSet(key, list);
    chests.onGone = (key) => this.watchers.delete(key);
    const net = this.net;
    net.on("chopen", (m, from) => this._onOpen(m, from));
    net.on("chclose", (m, from) => this._onClose(m, from));
    net.on("chop", (m, from) => this._onOp(m, from));
    net.on("chst", (m) => this._onState(m));
    net.on("chset", (m) => this._onSet(m));
    net.on("chres", (m) => this._onResult(m));
  }

  start() {
    if (!this.chests) return;
    this.chests.authority = this.net.isHost;
    // (A guest keeps no chests of its own: whatever it shows comes from the host.)
    if (!this.net.isHost) this.chests.store.clear();
  }

  stop() {
    this.watchers.clear();
    for (const done of this._ops.values()) done(false);
    this._ops.clear();
  }

  update() {
    this.chests?.update();
  }

  playerLeft(p) {
    for (const set of this.watchers.values()) set.delete(p.pid);
  }

  // ---------- A guest: asking the host (js/chests.js calls these) ----------

  open(view) {
    if (this.mp.active) this.net.toHost({ t: "chopen", p: [view.x, view.y, view.z] });
  }

  close(view) {
    if (this.mp.active) this.net.toHost({ t: "chclose", p: [view.x, view.y, view.z] });
    for (const done of this._ops.values()) done(false);
    this._ops.clear();
  }

  op(view, changes, done) {
    if (!this.mp.active) return done(false);
    const n = this._n++;
    this._ops.set(n, done);
    this.net.toHost({ t: "chop", p: [view.x, view.y, view.z], n, c: changes.map(([i, b, a]) => [i, encodeStack(b), encodeStack(a)]) });
  }

  // ---------- The host ----------

  _onOpen(m, from) {
    if (!this.net.isHost || !this.chests) return;
    const p = posOf(m.p);
    if (!p) return;
    const [x, y, z] = p;
    const world = this.game.world;
    // (Ground the host hasn't loaded: the guest's word that a chest is
    // there, unless a recorded edit says it is something else now.)
    let ok;
    if (world.getChunk(x >> 4, z >> 4)) ok = IS_CHEST[world.getBlock(x, y, z)] === 1;
    else {
      const id = world.edits.get(chunkKey(x >> 4, z >> 4))?.get(blockIndex(x & 15, y, z & 15));
      ok = id === undefined || IS_CHEST[id] === 1;
    }
    if (!ok) {
      this.net.send(from, { t: "chst", p, s: 0 });
      return;
    }
    const slots = this.chests.contents(x, y, z);
    const key = Chests.key(x, y, z);
    let set = this.watchers.get(key);
    if (!set) this.watchers.set(key, (set = new Set()));
    set.add(from);
    this.net.send(from, { t: "chst", p, s: slots.map(encodeStack) });
  }

  _onClose(m, from) {
    if (!this.net.isHost) return;
    const p = posOf(m.p);
    if (!p) return;
    const key = Chests.key(p[0], p[1], p[2]);
    const set = this.watchers.get(key);
    if (!set) return;
    set.delete(from);
    if (!set.size) this.watchers.delete(key);
  }

  _onOp(m, from) {
    if (!this.net.isHost || !this.chests) return;
    const p = posOf(m.p);
    if (!p || !Number.isInteger(m.n)) return;
    const key = Chests.key(p[0], p[1], p[2]);
    let ok = false;
    if (this.watchers.get(key)?.has(from) && Array.isArray(m.c) && m.c.length <= CHEST_SLOTS) {
      // (A stack that doesn't decode makes the whole change invalid.)
      const changes = [];
      for (const ch of m.c) {
        if (!Array.isArray(ch)) break;
        const b = decodeStack(ch[1]);
        const a = decodeStack(ch[2]);
        if ((ch[1] && !b) || (ch[2] && !a)) break;
        changes.push([ch[0], b, a]);
      }
      if (changes.length === m.c.length) ok = this.chests.apply(key, changes, from);
    }
    if (ok) this.net.send(from, { t: "chres", p, n: m.n, ok: 1 });
    else {
      const slots = this.chests.store.get(key);
      this.net.send(from, { t: "chres", p, n: m.n, ok: 0, s: slots ? slots.map(encodeStack) : 0 });
    }
  }

  // Host: a chest changed (anyone's click): to everyone else who has it open.
  _sendSet(key, list) {
    if (!this.mp.active || !this.net.isHost) return;
    const set = this.watchers.get(key);
    if (!set || !set.size) return;
    const msg = { t: "chset", p: keyPos(key), c: list.map(([i, s]) => [i, encodeStack(s)]) };
    for (const pid of set) if (pid !== this.net.pid) this.net.send(pid, msg);
  }

  // ---------- A guest: the host's answers ----------

  _slotsOf(s) {
    if (!Array.isArray(s) || s.length !== CHEST_SLOTS) return null;
    return s.map((e) => decodeStack(e));
  }

  _onState(m) {
    if (this.net.isHost || !this.chests) return;
    const p = posOf(m.p);
    if (p) this.chests.remoteState(Chests.key(p[0], p[1], p[2]), this._slotsOf(m.s));
  }

  _onSet(m) {
    if (this.net.isHost || !this.chests) return;
    const p = posOf(m.p);
    if (!p || !Array.isArray(m.c) || m.c.length > CHEST_SLOTS) return;
    const list = [];
    for (const ch of m.c) if (Array.isArray(ch) && Number.isInteger(ch[0])) list.push([ch[0], decodeStack(ch[1])]);
    this.chests.remoteSet(Chests.key(p[0], p[1], p[2]), list);
  }

  _onResult(m) {
    if (this.net.isHost || !this.chests) return;
    const done = this._ops.get(m.n);
    this._ops.delete(m.n);
    const p = posOf(m.p);
    // (Refused: the chest as it is now, or gone.)
    if (!m.ok && p && m.s !== undefined) this.chests.remoteState(Chests.key(p[0], p[1], p[2]), this._slotsOf(m.s));
    done?.(!!m.ok);
  }
}
