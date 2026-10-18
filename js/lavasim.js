// Flowing lava (Round 11), the way it flows in Minecraft's Overworld: a
// source (LAVA) runs 3 blocks over flat ground (one flowing id per block of
// distance, js/content/nature.js), falls into holes (a flowing cell under
// lava spreads again like a source where it lands), and steps every 1.5 s
// (vanilla's 30 game ticks), much slower than water. Cut off, a flow dries
// up from its source outward: a cell keeps only the support of a neighbour
// strictly nearer its source, so a flow can never prop itself up.
//
// Lava and water: lava touched by water (beside or above) hardens, a source
// into obsidian and a flow into cobblestone; lava flowing down onto water
// turns that water into stone. (Water never flows into lava: watersim.js.)
//
// Like the water sim, only woken cells cost anything: an edit wakes the lava
// around it (World.changeListeners), and a lava cell's random tick (the
// host's) wakes it too (a flow saved mid-way). Online each player runs it for
// their own edits (another player's arrive already flowed, as for water).
import { BLOCK, IS_REPLACEABLE, IS_WET } from "./blocks.js";
import { WORLD_HEIGHT } from "./constants.js";
import { LAVA, OBSIDIAN } from "./content/ids.js";
import { isLava, lavaLevel, lavaFlowId, LAVA_MAX_LEVEL } from "./content/nature.js";

export const LAVA_STEP = 1.5; // seconds a flow takes per block
const BUDGET_PER_FRAME = 200;
const WRITES_PER_FRAME = 1024;
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class LavaSim {
  constructor(world) {
    this.world = world;
    this.time = 0;
    this.processed = 0; // cells ticked (stats / tests)
    // Woken cells: due now (touching water: lava hardens at once) and due
    // after a step (FIFO: every delay is the same).
    this._now = new Set();
    this._later = []; // [due, key] pairs
    this._queued = new Set(); // keys in _later
    this._pending = new Map(); // this update's writes, read back by the ticks
    this._batch = [];
    world.lavaSim = this;
    world.changeListeners.push((changed, opts) => this._onEdit(changed, opts));
  }

  get activeCount() {
    return this._now.size + this._queued.size;
  }

  _key(x, y, z) {
    return `${x},${y},${z}`;
  }

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

  // A lava cell to look at: at once if water touches it, else after a step.
  wake(x, y, z) {
    if (!isLava(this.world.getBlock(x, y, z))) return;
    const key = this._key(x, y, z);
    if (this._touchesWater(x, y, z)) {
      this._now.add(key);
      return;
    }
    if (this._queued.has(key)) return;
    this._queued.add(key);
    this._later.push(this.time + LAVA_STEP, key);
  }

  _onEdit(changed, { recordEdit = true, remote = false } = {}) {
    if (!recordEdit || remote) return;
    const w = this.world;
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const y = changed[i + 1];
      const z = changed[i + 2];
      if (isLava(w.getBlock(x, y, z))) this.wake(x, y, z);
      for (const [dx, dz] of SIDES) if (isLava(w.getBlock(x + dx, y, z + dz))) this.wake(x + dx, y, z + dz);
      if (isLava(w.getBlock(x, y + 1, z))) this.wake(x, y + 1, z);
      if (isLava(w.getBlock(x, y - 1, z))) this.wake(x, y - 1, z);
    }
  }

  // Water beside or above (vanilla: every way but down).
  _touchesWater(x, y, z) {
    if (IS_WET[this._get(x, y + 1, z)]) return true;
    for (const [dx, dz] of SIDES) if (IS_WET[this._get(x + dx, y, z + dz)]) return true;
    return false;
  }

  update(dt) {
    this.time += dt;
    if (this._now.size === 0 && this._later.length === 0) return;
    let n = 0;
    for (const key of this._now) {
      if (n >= BUDGET_PER_FRAME) break;
      this._now.delete(key);
      this._tick(key);
      n++;
    }
    let head = 0;
    const q = this._later;
    while (head < q.length && q[head] <= this.time && n < BUDGET_PER_FRAME && this._batch.length < WRITES_PER_FRAME * 4) {
      const key = q[head + 1];
      head += 2;
      this._queued.delete(key);
      this._tick(key);
      n++;
    }
    if (head) q.splice(0, head);
    this.processed += n;
    this._flush();
  }

  _flush() {
    if (!this._batch.length) return;
    const list = this._batch;
    this._batch = [];
    this._pending.clear();
    this.world.setBlocks(list);
  }

  _tick(key) {
    const world = this.world;
    const [x, y, z] = key.split(",").map(Number);
    if (!world.getChunk(x >> 4, z >> 4)) return;
    const id = this._get(x, y, z);
    if (!isLava(id)) return;
    if (this._touchesWater(x, y, z)) {
      this._set(x, y, z, id === LAVA ? OBSIDIAN : BLOCK.COBBLESTONE);
      return;
    }
    const fed = y + 1 < WORLD_HEIGHT && isLava(this._get(x, y + 1, z)); // (falling: spreads like a source)
    let level = 0;
    if (id !== LAVA && !fed) {
      // A flow: one block farther than its nearest neighbour toward a source.
      let best = LAVA_MAX_LEVEL + 1;
      for (const [dx, dz] of SIDES) {
        const n = this._get(x + dx, y, z + dz);
        if (!isLava(n)) continue;
        const nfed = isLava(this._get(x + dx, y + 1, z + dz));
        best = Math.min(best, (n === LAVA || nfed ? 0 : lavaLevel(n)) + 1);
      }
      if (best > LAVA_MAX_LEVEL) {
        this._set(x, y, z, BLOCK.AIR); // (cut off: dries up; its neighbours wake from the edit)
        return;
      }
      if (lavaLevel(id) !== best) this._set(x, y, z, lavaFlowId(best));
      level = best;
    }
    // Down first: into a hole (or onto water, which turns to stone).
    let open = false;
    if (y > 0) {
      const below = this._get(x, y - 1, z);
      if (IS_WET[below]) this._set(x, y - 1, z, BLOCK.STONE);
      else if (!isLava(below) && IS_REPLACEABLE[below]) {
        this._set(x, y - 1, z, lavaFlowId(1));
        open = true;
      } else if (isLava(below)) open = below !== LAVA;
    }
    // Then sideways, one block farther, unless a flow is pouring down a hole
    // (a source spreads anyway).
    if (open && id !== LAVA) return;
    const next = level + 1;
    if (next > LAVA_MAX_LEVEL) return;
    for (const [dx, dz] of SIDES) {
      const nx = x + dx;
      const nz = z + dz;
      if (!world.getChunk(nx >> 4, nz >> 4)) continue;
      const n = this._get(nx, y, nz);
      if (isLava(n) || IS_WET[n] || !IS_REPLACEABLE[n]) continue;
      this._set(nx, y, nz, lavaFlowId(next));
    }
  }
}
