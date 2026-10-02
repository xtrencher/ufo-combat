// Block changes online. Both sides generate the same terrain from the seed,
// so only the changes travel: every edit made here (mining, building, a
// crater, flowing water, falling sand, a nuke) is collected for a moment and
// sent as one batch, run-length encoded per chunk (the format the saves use).
// The host applies a client's batch and passes it on; the other clients
// apply it. Edits that came from another player never start water or sand
// moving here (the player who made them already did that, and those results
// come as edits too).
//
// Races: two players changing the same block within a moment of each other
// would each end up with the other's change last. The host remembers who
// changed what in the last 1.5 s; when a client's change lands on a block
// someone else just changed, the host sends that client the final value.
//
// A joining player gets every edit of the world (in parts), then the live stream.
import { CHUNK_SIZE, WORLD_HEIGHT, chunkKey, blockIndex } from "../constants.js";
import { encodeChunkEdits, decodeChunkEdits, setEdit } from "../storage.js";

const FLUSH_INTERVAL = 0.05; // seconds between batches
const MAX_BATCH_CHUNKS = 48; // chunks per message (a nuke's crater goes out in several)
const RACE_WINDOW = 1500; // ms

export class WorldSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.world = mp.game.world;
    this.out = new Map(); // chunkKey -> Map<index, id>: our edits waiting to go
    this.applying = false;
    this._t = 0;
    this.recent = new Map(); // host: "x,y,z" -> { pid, t }
    this._recentT = 0;
    this.stats = { sent: 0, received: 0 };
    const world = this.world;
    // Everything this peer changes.
    world.changeListeners.push((changed, opts) => {
      if (!this.mp.active || this.applying || opts?.remote || opts?.recordEdit === false) return;
      for (let i = 0; i < changed.length; i += 3) this._queue(changed[i], changed[i + 1], changed[i + 2], world.getBlock(changed[i], changed[i + 1], changed[i + 2]));
    });
    // Blasts far out, in chunks that are not loaded here (recorded only).
    const queueEdit = world.queueEdit.bind(world);
    world.queueEdit = (x, y, z, id) => {
      const loaded = !!world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
      queueEdit(x, y, z, id);
      if (!loaded && this.mp.active && !this.applying) this._queue(Math.floor(x), Math.floor(y), Math.floor(z), id);
    };
    this.net.on("ed", (m, from) => this._onEdits(m, from));
    this.net.registerSync("world", {
      save: () => this._snapshot(),
      load: (data) => this._loadSnapshot(data),
    });
  }

  _queue(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = x >> 4;
    const cz = z >> 4;
    const key = chunkKey(cx, cz);
    let map = this.out.get(key);
    if (!map) this.out.set(key, (map = new Map()));
    map.set(blockIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE), id);
    if (this.net.isHost) this.recent.set(`${x},${y},${z}`, { pid: this.net.pid, t: performance.now() });
  }

  update(dt) {
    this._t -= dt;
    if (this._t <= 0 && this.out.size) {
      this._t = FLUSH_INTERVAL;
      this._flush();
    }
    // (Forget old race records now and then.)
    this._recentT -= dt;
    if (this._recentT <= 0 && this.recent.size) {
      this._recentT = 2;
      const t = performance.now();
      for (const [k, r] of this.recent) if (t - r.t > RACE_WINDOW) this.recent.delete(k);
    }
  }

  _flush() {
    let c = {};
    let n = 0;
    const send = () => {
      if (!n) return;
      const msg = { t: "ed", c };
      if (this.net.isHost) this.net.broadcast(msg);
      else this.net.toHost(msg);
      c = {};
      n = 0;
    };
    for (const [key, map] of this.out) {
      c[key] = encodeChunkEdits(map);
      this.stats.sent += map.size;
      if (++n >= MAX_BATCH_CHUNKS) send();
    }
    send();
    this.out.clear();
  }

  stop() {
    this.out.clear();
    this.recent.clear();
  }

  // ---------- Incoming ----------

  _onEdits(m, from) {
    if (!m.c || typeof m.c !== "object") return;
    const world = this.world;
    const changed = this._apply(m.c, from);
    if (!this.net.isHost) return;
    // Host: pass it on, and settle races with the sender.
    this.net.broadcast(m, { except: from });
    if (!changed.raced.length) return;
    const fix = new Map();
    for (const [x, y, z] of changed.raced) {
      const cx = x >> 4;
      const cz = z >> 4;
      const key = chunkKey(cx, cz);
      let map = fix.get(key);
      if (!map) fix.set(key, (map = new Map()));
      map.set(blockIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE), world.getBlock(x, y, z));
    }
    const c = {};
    for (const [key, map] of fix) c[key] = encodeChunkEdits(map);
    this.net.send(from, { t: "ed", c, fix: 1 });
  }

  // Applies a batch: loaded chunks in one bulk edit, the others recorded
  // (applied when they load). Returns { raced: [[x, y, z]] } (host).
  _apply(chunks, from) {
    const world = this.world;
    const list = [];
    const raced = [];
    const t = performance.now();
    const host = this.net.isHost;
    let count = 0;
    for (const [key, enc] of Object.entries(chunks)) {
      const m = /^(-?\d+),(-?\d+)$/.exec(key);
      if (!m || typeof enc !== "string") continue;
      const cx = Number(m[1]);
      const cz = Number(m[2]);
      let map;
      try {
        map = decodeChunkEdits(enc);
      } catch {
        continue;
      }
      const loaded = !!world.getChunk(cx, cz);
      for (const [index, id] of map) {
        const lx = index & 15;
        const lz = (index >> 4) & 15;
        const y = index >> 8;
        const x = cx * CHUNK_SIZE + lx;
        const z = cz * CHUNK_SIZE + lz;
        count++;
        if (host) {
          const k = `${x},${y},${z}`;
          const r = this.recent.get(k);
          if (r && r.pid !== from && t - r.t < RACE_WINDOW) raced.push([x, y, z]);
          this.recent.set(k, { pid: from, t });
        }
        if (loaded) list.push(x, y, z, id);
        else {
          setEdit(world.edits, cx, cz, index, id);
          world.dirtyEditChunks.add(key);
          world.lodDirty.add(key);
        }
      }
    }
    this.stats.received += count;
    if (list.length) {
      this.applying = true;
      try {
        world.setBlocks(list, { remote: true });
      } finally {
        this.applying = false;
      }
      // Plants over a changed block go with it (a few edits; a blast clears its own patch).
      const grass = this.game.grass;
      if (grass && grass.density > 0 && list.length <= 400) for (let i = 0; i < list.length; i += 4) grass.clear(list[i], list[i + 2], 1.2);
    }
    if (count && world.onEdit) world.onEdit();
    return { raced };
  }

  // ---------- Joining ----------

  _snapshot() {
    const chunks = {};
    for (const [key, map] of this.world.edits) if (map.size) chunks[key] = encodeChunkEdits(map);
    return { chunks };
  }

  _loadSnapshot(data) {
    if (!data?.chunks) return;
    const world = this.world;
    // The host's edits replace whatever this page had (a guest has none of its own).
    const edits = new Map();
    for (const [key, enc] of Object.entries(data.chunks)) {
      if (typeof enc !== "string" || !/^-?\d+,-?\d+$/.test(key)) continue;
      try {
        edits.set(key, decodeChunkEdits(enc));
      } catch {}
    }
    world.loadEdits(edits);
    // Chunks already built: apply their edits now (in one bulk edit).
    const list = [];
    for (const chunk of world.chunks.values()) {
      const map = edits.get(chunk.key);
      if (!map) continue;
      for (const [index, id] of map) {
        if (chunk.blocks[index] === id) continue;
        list.push(chunk.cx * CHUNK_SIZE + (index & 15), index >> 8, chunk.cz * CHUNK_SIZE + ((index >> 4) & 15), id);
      }
    }
    for (const key of edits.keys()) world.lodDirty.add(key);
    if (list.length) {
      this.applying = true;
      try {
        world.setBlocks(list, { remote: true });
      } finally {
        this.applying = false;
      }
    }
    this.stats.received += list.length / 4;
  }
}
