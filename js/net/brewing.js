// Brewing online (Round 11): the host owns every brewing stand (js/brewing.js),
// exactly as the furnaces (js/net/furnace.js): a guest opening one asks the
// host ("bropen") and gets its slots and brew time ("brst"); a click is a
// change of slots with what each held before ("brop"), applied by the host
// only if the stand still holds that; the host answers ("brres") and passes
// the new slots to everyone else with it open ("brset"), the brew time when
// it starts or stops ("brbar"). Closing tells the host ("brclose").
// Thrown bottles: a player's throw is drawn by everyone ("pth": the bottle,
// where and how fast), and where it broke is the thrower's word ("psp"):
// each game applies the splash to its own player, the host to its
// creatures. Older peers ignore these messages.
// (Round 12) A stand of the Nether or the End: its messages carry the
// dimension ("dm", js/dim-registry.js), as the furnaces'; a bottle thrown in
// another dimension is never seen here (js/net/session.js drops it).
import * as THREE from "three";
import { BREWING_SLOTS, isBrewingStand, BREWING_NEAR_GUEST, isThrownBottle } from "../brewing.js";
import { encodeStack, decodeStack } from "../inventory.js";
import { chunkKey, blockIndex } from "../constants.js";
import { dimOfCode, dmOf, parseDimKey, codeOf } from "../dim-registry.js";

const posOf = (p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isInteger) && p[1] >= 0 && p[1] < 256 ? p : null);
const keyPos = (key) => parseDimKey(key)?.slice(0, 3) ?? key.split(",").map(Number);
const keyDm = (key) => dmOf(parseDimKey(key)?.[3]);
const vec = (a) => (Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(n) && Math.abs(n) < 1e6) ? new THREE.Vector3(a[0], a[1], a[2]) : null);
const r2 = (v) => Math.round(v * 100) / 100;
const BARS_EVERY = 2;

export class BrewingSync {
  // game: brewing (BrewingStands), throws (PotionThrows), world.
  constructor(mp, { brewing, throws } = {}) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.brewing = brewing || mp.game.brewing || null;
    this.throws = throws || mp.game.potionThrows || null;
    this.watchers = new Map();
    this._ops = new Map();
    this._n = 1;
    this._barsT = 0;
    const net = this.net;
    const br = this.brewing;
    if (br) {
      if (this.game.GUEST) br.authority = false;
      br.remote = this;
      br.onChanged = (key, list) => this._sendSet(key, list);
      br.onBars = (key) => this._sendBars(key);
      br.onGone = (key) => this._sendGone(key);
      br.watched = (key) => this.watchers.has(key);
      br.nearGuest = (x, z, dim) => this._nearGuest(x, z, dim);
      net.on("bropen", (m, from) => this._onOpen(m, from));
      net.on("brclose", (m, from) => this._onClose(m, from));
      net.on("brop", (m, from) => this._onOp(m, from));
      net.on("brst", (m) => this._onState(m));
      net.on("brset", (m) => this._onSet(m));
      net.on("brbar", (m) => this._onBars(m));
      net.on("brres", (m) => this._onResult(m));
    }
    const th = this.throws;
    if (th) {
      th.onThrow = (id, pos, vel, key) => {
        if (this.mp.active) this.net.toAll({ t: "pth", id, k: key, p: [r2(pos.x), r2(pos.y), r2(pos.z)], v: [r2(vel.x), r2(vel.y), r2(vel.z)] });
      };
      th.onSplash = (id, at, key) => {
        if (this.mp.active) this.net.toAll({ t: "psp", id, k: key, p: [r2(at.x), r2(at.y), r2(at.z)] });
      };
      // (Offline or the host: the creatures are this game's.)
      th.authorityOverMobs = () => !this.mp.active || this.net.isHost;
      th.othersMayHarm = () => !this.mp.active || !!this.mp.pvpAllowed?.();
      net.on("pth", (m, from) => {
        const p = vec(m.p);
        const v = vec(m.v);
        if (p && v && Number.isInteger(m.id) && isThrownBottle(m.id)) th.remoteThrow(m.id, p, v, `${from}:${m.k}`);
      });
      net.on("psp", (m, from) => {
        const p = vec(m.p);
        if (p && Number.isInteger(m.id) && isThrownBottle(m.id)) th.remoteSplash(m.id, p, `${from}:${m.k}`);
      });
    }
  }

  start() {
    if (!this.brewing) return;
    this.brewing.authority = this.net.isHost;
    if (!this.net.isHost) this.brewing.store.clear();
  }

  stop() {
    this.watchers.clear();
    for (const done of this._ops.values()) done(false);
    this._ops.clear();
    this.throws?.clear?.();
  }

  update(dt) {
    if (!this.brewing || !this.net.isHost || !this.watchers.size) return;
    this._barsT -= dt;
    if (this._barsT > 0) return;
    this._barsT = BARS_EVERY;
    for (const key of this.watchers.keys()) {
      const b = this.brewing.bars(key);
      if (b && b[0] > 0) this._sendBars(key);
    }
  }

  playerLeft(p) {
    for (const [key, set] of this.watchers) {
      set.delete(p.pid);
      if (!set.size) this.watchers.delete(key);
    }
  }

  _nearGuest(x, z, dim) {
    if (!this.mp.active || !this.net.isHost) return false;
    const code = codeOf(dim);
    const players = this.mp.players;
    for (const r of players?.all?.() || players?.active?.() || []) {
      if ((r.dim | 0) !== code) continue;
      const p = r.position;
      if (p && Math.abs(p.x - x) < BREWING_NEAR_GUEST && Math.abs(p.z - z) < BREWING_NEAR_GUEST) return true;
    }
    return false;
  }

  // ---------- A guest: asking the host (js/brewing.js calls these) ----------

  open(view) {
    if (this.mp.active) this.net.toHost({ t: "bropen", p: [view.x, view.y, view.z], ...keyDm(view.key) });
  }

  close(view) {
    if (this.mp.active) this.net.toHost({ t: "brclose", p: [view.x, view.y, view.z], ...keyDm(view.key) });
  }

  op(view, changes, done) {
    if (!this.mp.active) return done(false);
    const n = this._n++;
    this._ops.set(n, done);
    this.net.toHost({ t: "brop", p: [view.x, view.y, view.z], n, c: changes.map(([i, b, a]) => [i, encodeStack(b), encodeStack(a)]), ...keyDm(view.key) });
  }

  // ---------- The host ----------

  _isStandAt(x, y, z, dim) {
    const world = this.game.world;
    if (dim === world.dim && world.getChunk(x >> 4, z >> 4)) return isBrewingStand(world.getBlock(x, y, z));
    return isBrewingStand(world.editsOf(dim).get(chunkKey(x >> 4, z >> 4))?.get(blockIndex(x & 15, y, z & 15)));
  }

  _onOpen(m, from) {
    if (!this.net.isHost || !this.brewing) return;
    const p = posOf(m.p);
    if (!p) return;
    const [x, y, z] = p;
    const dim = dimOfCode(m.dm);
    if (!this._isStandAt(x, y, z, dim)) {
      this.net.send(from, { t: "brst", p, s: 0, ...dmOf(dim) });
      return;
    }
    const b = this.brewing.contents(x, y, z, dim);
    let set = this.watchers.get(b.key);
    if (!set) this.watchers.set(b.key, (set = new Set()));
    set.add(from);
    this.net.send(from, { t: "brst", p, s: b.slots.map(encodeStack), b: this.brewing.bars(b.key), ...dmOf(dim) });
  }

  _onClose(m, from) {
    if (!this.net.isHost) return;
    const p = posOf(m.p);
    if (!p) return;
    const key = this.brewing.keyOf(p[0], p[1], p[2], dimOfCode(m.dm));
    const set = this.watchers.get(key);
    if (!set) return;
    set.delete(from);
    if (!set.size) this.watchers.delete(key);
  }

  _onOp(m, from) {
    if (!this.net.isHost || !this.brewing) return;
    const p = posOf(m.p);
    if (!p || !Number.isInteger(m.n)) return;
    const dim = dimOfCode(m.dm);
    const key = this.brewing.keyOf(p[0], p[1], p[2], dim);
    let ok = false;
    if (this.watchers.get(key)?.has(from) && Array.isArray(m.c) && m.c.length <= BREWING_SLOTS) {
      const changes = [];
      for (const ch of m.c) {
        if (!Array.isArray(ch)) break;
        const b = decodeStack(ch[1]);
        const a = decodeStack(ch[2]);
        if ((ch[1] && !b) || (ch[2] && !a)) break;
        changes.push([ch[0], b, a]);
      }
      if (changes.length === m.c.length) ok = this.brewing.apply(key, changes, from);
    }
    if (ok) this.net.send(from, { t: "brres", p, n: m.n, ok: 1, ...dmOf(dim) });
    else {
      const b = this.brewing.store.get(key);
      this.net.send(from, { t: "brres", p, n: m.n, ok: 0, s: b ? b.slots.map(encodeStack) : 0, b: b ? this.brewing.bars(key) : 0, ...dmOf(dim) });
    }
  }

  _sendSet(key, list) {
    if (!this.mp.active || !this.net.isHost) return;
    const set = this.watchers.get(key);
    if (!set || !set.size) return;
    const msg = { t: "brset", p: keyPos(key), c: list.map(([i, s]) => [i, encodeStack(s)]), b: this.brewing.bars(key), ...keyDm(key) };
    for (const pid of set) if (pid !== this.net.pid) this.net.send(pid, msg);
  }

  _sendBars(key) {
    if (!this.mp.active || !this.net.isHost) return;
    const set = this.watchers.get(key);
    const b = set?.size ? this.brewing.bars(key) : null;
    if (!b) return;
    const msg = { t: "brbar", p: keyPos(key), b, ...keyDm(key) };
    for (const pid of set) if (pid !== this.net.pid) this.net.send(pid, msg);
  }

  _sendGone(key) {
    const set = this.watchers.get(key);
    this.watchers.delete(key);
    if (!this.mp.active || !this.net.isHost || !set) return;
    const msg = { t: "brst", p: keyPos(key), s: 0, ...keyDm(key) };
    for (const pid of set) if (pid !== this.net.pid) this.net.send(pid, msg);
  }

  // ---------- A guest: the host's answers ----------

  _slotsOf(s) {
    if (!Array.isArray(s) || s.length !== BREWING_SLOTS) return null;
    return s.map((e) => decodeStack(e));
  }

  _onState(m) {
    if (this.net.isHost || !this.brewing) return;
    const p = posOf(m.p);
    if (p) this.brewing.remoteState(this.brewing.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), this._slotsOf(m.s), m.b);
  }

  _onSet(m) {
    if (this.net.isHost || !this.brewing) return;
    const p = posOf(m.p);
    if (!p || !Array.isArray(m.c) || m.c.length > BREWING_SLOTS) return;
    const list = [];
    for (const ch of m.c) if (Array.isArray(ch) && Number.isInteger(ch[0])) list.push([ch[0], decodeStack(ch[1])]);
    this.brewing.remoteSet(this.brewing.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), list, m.b);
  }

  _onBars(m) {
    if (this.net.isHost || !this.brewing) return;
    const p = posOf(m.p);
    if (p) this.brewing.remoteBars(this.brewing.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), m.b);
  }

  _onResult(m) {
    if (this.net.isHost || !this.brewing) return;
    const done = this._ops.get(m.n);
    this._ops.delete(m.n);
    const p = posOf(m.p);
    if (!m.ok && p && m.s !== undefined) this.brewing.remoteState(this.brewing.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), this._slotsOf(m.s), m.b);
    done?.(!!m.ok);
  }
}
