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
// (js/net/items.js). Peers from before Round 11 are refused at the handshake
// (NET_VERSION 9).
//
// (Round 12) Every message about a chest of the Nether or the End carries
// its dimension ("dm": js/dim-registry.js; none: the Overworld's), and the
// host keeps every dimension's chests: a guest in the Nether opens the
// Nether's chest at that place, whatever dimension the host is in.
// (Round 12) A double chest is its two halves, each its own chest: opened
// and closed one by one; a click that changes both says the second half's
// slots in "p2"/"c2" of the same "chop", applied with the first or not at
// all (refused: "s"/"s2", both halves). Barrels and shulker boxes are
// chests here too. A guest that places a shulker box holding things tells
// the host what is in it ("chfill"); a bell rung is heard by everyone in
// that dimension ("bell", passed on by the host). Older peers ignore these.
import { encodeStack, decodeStack, CHEST_SLOTS, IS_STORAGE } from "../chests.js";
import { chunkKey, blockIndex } from "../constants.js";
import { dimOfCode, dmOf, parseDimKey, codeOf } from "../dim-registry.js";

const posOf = (p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isInteger) && p[1] >= 0 && p[1] < 256 ? p : null);
// [x, y, z] of a key, and its dimension's field for a message.
const keyPos = (key) => parseDimKey(key)?.slice(0, 3) ?? key.split(",").map(Number);
const keyDm = (key) => dmOf(parseDimKey(key)?.[3]);

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
    net.on("chfill", (m, from) => this._onFill(m, from));
    net.on("bell", (m, from) => this._onBell(m, from));
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

  // (Round 12: each half of a double chest.)
  open(view) {
    if (!this.mp.active) return;
    for (const part of view.parts) this.net.toHost({ t: "chopen", p: [part.x, part.y, part.z], ...keyDm(part.key) });
  }

  // (A click already sent still settles from the host's "chres": the channel
  // is ordered, so the host applies it before this close.)
  close(view) {
    if (!this.mp.active) return;
    for (const part of view.parts) this.net.toHost({ t: "chclose", p: [part.x, part.y, part.z], ...keyDm(part.key) });
  }

  // (Round 12) A shulker box this guest placed, holding `slots`.
  fill(x, y, z, slots) {
    if (this.mp.active) this.net.toHost({ t: "chfill", p: [x, y, z], s: slots.map(encodeStack), ...dmOf(this.game.world.dim) });
  }

  // (Round 12) A bell this player rang: everyone else hears it.
  bell(x, y, z) {
    if (this.mp.active) this.net.toAll({ t: "bell", p: [x, y, z], ...dmOf(this.game.world.dim) });
  }

  // A generated chest this guest broke: the host spills its loot if it
  // hasn't that ground loaded (it rides with the edit, js/net/world.js).
  goneLocal(x, y, z) {
    if (this.mp.active) this.mp.world?.goneLocal?.(x, y, z);
  }

  // groups: [[part, [[slot, before, after], ...]], ...] (one per half the click changes).
  op(view, groups, done) {
    if (!this.mp.active) return done(false);
    const n = this._n++;
    this._ops.set(n, done);
    const enc = (changes) => changes.map(([i, b, a]) => [i, encodeStack(b), encodeStack(a)]);
    const [g0, g1] = groups;
    const a = view.parts[g0[0]];
    const msg = { t: "chop", p: [a.x, a.y, a.z], n, c: enc(g0[1]), ...keyDm(a.key) };
    if (g1) {
      const b = view.parts[g1[0]];
      msg.p2 = [b.x, b.y, b.z];
      msg.c2 = enc(g1[1]);
    }
    this.net.toHost(msg);
  }

  // ---------- The host ----------

  _onOpen(m, from) {
    if (!this.net.isHost || !this.chests) return;
    const p = posOf(m.p);
    if (!p) return;
    const [x, y, z] = p;
    const world = this.game.world;
    const dim = dimOfCode(m.dm);
    // (Ground the host hasn't loaded, or another dimension's: the guest's
    // word that a chest is there, unless a recorded edit says it is
    // something else now.)
    let ok;
    if (dim === world.dim && world.getChunk(x >> 4, z >> 4)) ok = IS_STORAGE[world.getBlock(x, y, z)] === 1;
    else {
      const id = world.editsOf(dim).get(chunkKey(x >> 4, z >> 4))?.get(blockIndex(x & 15, y, z & 15));
      ok = id === undefined || IS_STORAGE[id] === 1;
    }
    if (!ok) {
      this.net.send(from, { t: "chst", p, s: 0, ...dmOf(dim) });
      return;
    }
    const slots = this.chests.contents(x, y, z, dim);
    const key = this.chests.keyOf(x, y, z, dim);
    let set = this.watchers.get(key);
    if (!set) this.watchers.set(key, (set = new Set()));
    set.add(from);
    this.net.send(from, { t: "chst", p, s: slots.map(encodeStack), ...dmOf(dim) });
  }

  _onClose(m, from) {
    if (!this.net.isHost) return;
    const p = posOf(m.p);
    if (!p) return;
    const key = this.chests.keyOf(p[0], p[1], p[2], dimOfCode(m.dm));
    const set = this.watchers.get(key);
    if (!set) return;
    set.delete(from);
    if (!set.size) this.watchers.delete(key);
  }

  // (A stack that doesn't decode makes the whole change invalid: null.)
  _changes(c, key, from) {
    if (!this.watchers.get(key)?.has(from) || !Array.isArray(c) || c.length > CHEST_SLOTS) return null;
    const changes = [];
    for (const ch of c) {
      if (!Array.isArray(ch)) return null;
      const b = decodeStack(ch[1]);
      const a = decodeStack(ch[2]);
      if ((ch[1] && !b) || (ch[2] && !a)) return null;
      changes.push([ch[0], b, a]);
    }
    return changes;
  }

  _onOp(m, from) {
    if (!this.net.isHost || !this.chests) return;
    const p = posOf(m.p);
    if (!p || !Number.isInteger(m.n)) return;
    const dim = dimOfCode(m.dm);
    const key = this.chests.keyOf(p[0], p[1], p[2], dim);
    // (Round 12) A double chest's other half, changed in the same click.
    const p2 = m.p2 !== undefined ? posOf(m.p2) : null;
    const key2 = p2 ? this.chests.keyOf(p2[0], p2[1], p2[2], dim) : null;
    const list = [[key, this._changes(m.c, key, from)]];
    if (m.p2 !== undefined) list.push([key2, p2 ? this._changes(m.c2, key2, from) : null]);
    const ok = list.every(([k, c]) => k && c) && this.chests.applyMulti(list, from);
    if (ok) this.net.send(from, { t: "chres", p, n: m.n, ok: 1, ...dmOf(dim) });
    else {
      const enc = (k) => {
        const slots = k ? this.chests.store.get(k) : null;
        return slots ? slots.map(encodeStack) : 0;
      };
      this.net.send(from, { t: "chres", p, n: m.n, ok: 0, s: enc(key), ...(p2 ? { p2, s2: enc(key2) } : {}), ...dmOf(dim) });
    }
  }

  // (Round 12) A guest's shulker box placed with things in it.
  _onFill(m, from) {
    if (!this.net.isHost || !this.chests) return;
    const p = posOf(m.p);
    if (!p || !Array.isArray(m.s) || m.s.length !== CHEST_SLOTS) return;
    const slots = m.s.map((e) => decodeStack(e));
    this.chests.remoteFill(p[0], p[1], p[2], slots, dimOfCode(m.dm));
    void from;
  }

  // (Round 12) A bell rung somewhere: heard here if it is this dimension's
  // (the host passes a guest's on to everyone else: toAll's relay).
  _onBell(m) {
    const p = posOf(m.p);
    if (!p || !this.chests || (m.dm | 0) !== codeOf(this.game.world.dim)) return;
    this.chests.ringBell(p[0], p[1], p[2], true);
  }

  // Host: a chest changed (anyone's click): to everyone else who has it open.
  _sendSet(key, list) {
    if (!this.mp.active || !this.net.isHost) return;
    const set = this.watchers.get(key);
    if (!set || !set.size) return;
    const msg = { t: "chset", p: keyPos(key), c: list.map(([i, s]) => [i, encodeStack(s)]), ...keyDm(key) };
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
    if (p) this.chests.remoteState(this.chests.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), this._slotsOf(m.s));
  }

  _onSet(m) {
    if (this.net.isHost || !this.chests) return;
    const p = posOf(m.p);
    if (!p || !Array.isArray(m.c) || m.c.length > CHEST_SLOTS) return;
    const list = [];
    for (const ch of m.c) if (Array.isArray(ch) && Number.isInteger(ch[0])) list.push([ch[0], decodeStack(ch[1])]);
    this.chests.remoteSet(this.chests.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), list);
  }

  _onResult(m) {
    if (this.net.isHost || !this.chests) return;
    const done = this._ops.get(m.n);
    this._ops.delete(m.n);
    const p = posOf(m.p);
    // (Refused: the chest as it is now, or gone; Round 12: both halves.)
    if (!m.ok && p && m.s !== undefined) this.chests.remoteState(this.chests.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), this._slotsOf(m.s));
    const p2 = m.p2 !== undefined ? posOf(m.p2) : null;
    if (!m.ok && p2 && m.s2 !== undefined) this.chests.remoteState(this.chests.keyOf(p2[0], p2[1], p2[2], dimOfCode(m.dm)), this._slotsOf(m.s2));
    done?.(!!m.ok);
  }
}
