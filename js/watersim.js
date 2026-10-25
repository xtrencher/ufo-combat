// Flowing water: source blocks (the vast, untouched lakes/oceans/rivers the
// terrain generator paints) plus flowing water that spreads sideways and
// falls into holes, the way it does in Minecraft. Fixes water blocks left
// floating in mid-air after a block under them is dug out or blown away.
//
// Only "active" water is simulated: a block edit anywhere near water wakes
// the water touching it (World.changeListeners), and only woken cells sit in
// a queue, processed a bounded number per frame (see update()). The vast
// majority of the world's water is never touched and costs nothing.
//
// Original terrain water (never touched by the sim) behaves as an infinite
// source. Water the simulation itself creates by flowing remembers exactly
// which neighbor it flowed from (its "parent") and a level (0 = fed by a
// source or by falling water, up to MAX_FLOW_DISTANCE sideways from one).
// Drying up checks only that one parent cell, never a neighbor's cached
// level: that's what keeps a cut-off flow from "propping itself up" by
// borrowing support from a cell that only ever existed because of it in the
// first place (the same class of bug a naive flood-fill removal hits, and
// the reason the voxel light engine two-phases its own removal).
import { BLOCK, IS_REPLACEABLE, IS_WET, IS_SOLID } from "./blocks.js";
import { WORLD_HEIGHT } from "./constants.js";
import { vanillaRules, legacyTerrain } from "./worldtype.js";
import { isLava } from "./content/nature.js";

export const MAX_FLOW_DISTANCE = 4; // sideways reach of a flow from its source, in blocks
// (Round 11) A Survival world's water runs as far as vanilla's: 7.
export const VANILLA_FLOW_DISTANCE = 7;
// (Round 13) Vanilla's water (its reach, infinite sources), but not in an old
// Missions save on its old terrain: its builds' channels keep their water.
const vanillaWater = () => vanillaRules() && !legacyTerrain();
// Where water may flow: open cells, never lava (lava touched by water
// hardens instead: lavasim.js).
const openTo = (id) => !IS_WET[id] && IS_REPLACEABLE[id] && !isLava(id);
const BUDGET_PER_FRAME = 300;
// (a frame's writes go to the world as one batch, see _flush: one light
// update, one rebuild per chunk, one message online; this caps a flood
// front's batch)
const WRITES_PER_FRAME = 1024;

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class WaterSim {
  constructor(world) {
    this.world = world;
    this.active = new Set(); // "x,y,z" keys due for a tick
    this.meta = new Map(); // "x,y,z" -> { level, parent: [x,y,z] } for sim-made flow cells
    this.metaVersion = 0; // (moves with every change to meta: the autosave rebuilds its list only then)
    this.processed = 0; // cells ticked (stats / tests)
    // This update()'s writes, sent to the world together at its end: the
    // ticks read them from here meanwhile.
    this._pending = new Map(); // "x,y,z" -> block id
    this._batch = []; // flat [x, y, z, id, ...]
    world.changeListeners.push((changed, opts) => this._onEdit(changed, opts));
  }

  get activeCount() {
    return this.active.size;
  }

  _key(x, y, z) {
    return `${x},${y},${z}`;
  }

  // A changed cell may expose water to a new hole (beside or below it), or
  // be a water cell itself (placed, or laid bare by a removed neighbor).
  // recordEdit: false means the batch is out-of-band scaffolding (test
  // arenas, world setup), not a real player/explosion edit, so water leaves
  // it alone.
  _onEdit(changed, { recordEdit = true, remote = false } = {}) {
    if (remote) {
      // (Another peer's edit: a cell no longer water is no flow cell here
      // either; what the new water is comes with it, applyRemoteMeta.)
      for (let i = 0; i < changed.length; i += 3) {
        const key = this._key(changed[i], changed[i + 1], changed[i + 2]);
        if (this.meta.has(key) && this.world.getBlock(changed[i], changed[i + 1], changed[i + 2]) !== BLOCK.WATER && this.meta.delete(key)) this.metaVersion++;
      }
      return;
    }
    if (!recordEdit) return;
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const y = changed[i + 1];
      const z = changed[i + 2];
      this._wake(x, y, z);
      this._wakeAround(x, y, z);
    }
  }

  _wakeAround(x, y, z) {
    this._wake(x + 1, y, z);
    this._wake(x - 1, y, z);
    this._wake(x, y + 1, z);
    this._wake(x, y - 1, z);
    this._wake(x, y, z + 1);
    this._wake(x, y, z - 1);
  }

  _wake(x, y, z) {
    if (this.world.getBlock(x, y, z) === BLOCK.WATER) this.active.add(this._key(x, y, z));
  }

  // Processes up to `budget` active cells; any cells still needing another
  // look stay (or get re-added) for the next call.
  update(budget = BUDGET_PER_FRAME) {
    if (this.active.size === 0) return;
    let n = 0;
    for (const key of this.active) {
      if (n >= budget || this._batch.length >= WRITES_PER_FRAME * 4) break;
      n++;
      this.active.delete(key);
      this._tick(key);
    }
    this.processed += n;
    this._flush();
  }

  // A block as the ticks see it: this update's own writes first.
  _get(x, y, z) {
    if (this._pending.size) {
      const id = this._pending.get(this._key(x, y, z));
      if (id !== undefined) return id;
    }
    return this.world.getBlock(x, y, z);
  }

  _set(x, y, z, id) {
    this._pending.set(this._key(x, y, z), id);
    this._batch.push(x, y, z, id);
  }

  // The update's writes, as one edit batch (the change listeners, this
  // sim's own _onEdit too, then wake whatever they touched).
  _flush() {
    if (!this._batch.length) return;
    const list = this._batch;
    this._batch = [];
    this._pending.clear();
    this.world.setBlocks(list);
  }

  // A source: water the sim did not make.
  _isSource(x, y, z) {
    return this._get(x, y, z) === BLOCK.WATER && !this.meta.has(this._key(x, y, z));
  }

  _sourceSides(x, y, z) {
    let n = 0;
    for (const [dx, dz] of SIDES) if (this._isSource(x + dx, y, z + dz)) n++;
    return n;
  }

  _tick(key) {
    const world = this.world;
    const [x, y, z] = key.split(",").map(Number);
    // (an unloaded chunk keeps its cells' flow state: they are still flow
    // water when it comes back, not new infinite sources)
    if (!world.getChunk(x >> 4, z >> 4)) return;
    if (this._get(x, y, z) !== BLOCK.WATER) {
      if (this.meta.delete(key)) this.metaVersion++;
      return;
    }
    const info = this.meta.get(key); // absent = untouched terrain water (an infinite source)
    let level = 0;
    if (info) {
      const [px, py, pz] = info.parent;
      if (this._get(px, py, pz) !== BLOCK.WATER) {
        // Its one and only support is gone: dry up, and let whatever this
        // cell itself was supporting find out about it in turn.
        this._set(x, y, z, BLOCK.AIR);
        this.meta.delete(key);
        this.metaVersion++;
        this._wakeAround(x, y, z);
        return;
      }
      // (Survival: vanilla's infinite water, a flow between two sources
      // over solid ground or a source becomes one; its neighbours may then
      // meet the rule too)
      if (vanillaWater() && this._sourceSides(x, y, z) >= 2 && (y === 0 || IS_SOLID[this._get(x, y - 1, z)] || this._isSource(x, y - 1, z))) {
        this.meta.delete(key);
        this.metaVersion++;
        this._wakeAround(x, y, z);
      } else level = info.level;
    } else if (vanillaWater()) {
      // (a new source, a bucket poured onto flow: the flow beside it checks the rule)
      for (const [dx, dz] of SIDES) {
        const k = this._key(x + dx, y, z + dz);
        if (this.meta.has(k)) this.active.add(k);
      }
    }

    // Fall: an open cell directly below becomes full-strength falling water.
    if (y > 0) {
      const belowId = this._get(x, y - 1, z);
      if (openTo(belowId)) this._place(x, y - 1, z, 0, [x, y, z]);
    }

    // Spread sideways into open cells, one level weaker each step, up to the
    // flow's reach.
    if (level < (vanillaWater() ? VANILLA_FLOW_DISTANCE : MAX_FLOW_DISTANCE)) {
      for (const [dx, dz] of SIDES) {
        const nx = x + dx;
        const nz = z + dz;
        const id = this._get(nx, y, nz);
        if (!openTo(id)) continue;
        this._place(nx, y, nz, level + 1, [x, y, z]);
      }
    }
  }

  // (Round 12) The world goes to another dimension (js/dimensions.js): this
  // one's flow cells and woken cells are handed back (kept for its return),
  // `next` (or nothing) put in their place. This update's writes go first.
  swapDim(next = null) {
    this._flush();
    const prev = { meta: this.meta, active: this.active };
    this.meta = next?.meta || new Map();
    this.active = next?.active || new Set();
    this.metaVersion++;
    return prev;
  }

  // A saved list's flow cells as a map (another dimension's, kept aside).
  static metaFromList(list) {
    const meta = new Map();
    if (!Array.isArray(list)) return meta;
    for (let i = 0; i + 6 < list.length; i += 7) {
      const v = list.slice(i, i + 7);
      if (!v.every(Number.isInteger)) continue;
      meta.set(`${v[0]},${v[1]},${v[2]}`, { level: v[3], parent: [v[4], v[5], v[6]] });
    }
    return meta;
  }

  // The flow cells, for the world save: [x, y, z, level, px, py, pz, ...]
  // (at most `max` cells), and back. Without them a reload would turn every
  // flow cell into an infinite source. (meta: another dimension's, kept aside.)
  serializeMeta(max = 20000, meta = this.meta) {
    const out = [];
    for (const [key, info] of meta) {
      if (out.length >= max * 7) break;
      const [x, y, z] = key.split(",").map(Number);
      out.push(x, y, z, info.level, info.parent[0], info.parent[1], info.parent[2]);
    }
    return out;
  }

  loadMeta(list) {
    this.meta.clear();
    this.metaVersion++;
    if (!Array.isArray(list)) return;
    for (let i = 0; i + 6 < list.length; i += 7) {
      const v = list.slice(i, i + 7);
      if (!v.every(Number.isInteger)) continue;
      this.meta.set(this._key(v[0], v[1], v[2]), { level: v[3], parent: [v[4], v[5], v[6]] });
    }
  }

  // (Online) Another peer's water cells (js/net/world.js): w is flow cells
  // [x, y, z, level, px, py, pz, ...], ws sources [x, y, z, ...]. The sim is
  // not woken: the peer whose edit it was runs the flow.
  // (Round 12) meta: another dimension's (its peer's edits, kept aside here).
  applyRemoteMeta(w, ws, meta = this.meta) {
    const ok = (v) => Number.isInteger(v) && Math.abs(v) < 1e7;
    if (Array.isArray(w)) {
      const n = Math.min(w.length, 4096 * 7);
      for (let i = 0; i + 6 < n; i += 7) {
        const v = w.slice(i, i + 7);
        if (!v.every(ok) || v[3] < 0 || v[3] > 8) continue;
        meta.set(this._key(v[0], v[1], v[2]), { level: v[3], parent: [v[4], v[5], v[6]] });
      }
      this.metaVersion++;
    }
    if (Array.isArray(ws)) {
      const n = Math.min(ws.length, 4096 * 3);
      for (let i = 0; i + 2 < n; i += 3) {
        if (ok(ws[i]) && ok(ws[i + 1]) && ok(ws[i + 2])) meta.delete(this._key(ws[i], ws[i + 1], ws[i + 2]));
      }
      this.metaVersion++;
    }
  }

  _place(x, y, z, level, parent) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const world = this.world;
    if (!world.getChunk(x >> 4, z >> 4)) return;
    const key = this._key(x, y, z);
    const id = this._get(x, y, z);
    if (id === BLOCK.WATER) {
      const cur = this.meta.get(key);
      const curLevel = cur ? cur.level : 0;
      if (level < curLevel) {
        this.meta.set(key, { level, parent });
        this.metaVersion++;
        this.active.add(key);
      }
      return;
    }
    if (IS_REPLACEABLE[id] && !isLava(id)) {
      this._set(x, y, z, BLOCK.WATER);
      this.meta.set(key, { level, parent });
      this.metaVersion++;
      this.active.add(key);
    }
  }
}
