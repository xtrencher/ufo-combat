// The voxel world: chunk streaming, block access and edits, lighting,
// meshing, persistence of edits, and ray casting.
//
// Chunk pipeline: a chunk is *generated* (terrain + saved edits + light)
// within renderDistance + 1.5 chunks, and *meshed* once all 8 of its
// neighbors are generated (meshing reads a 1-block border from them for
// face culling, ambient occlusion and smooth light). So each chunk is
// normally meshed exactly once, and the border of loaded terrain is never
// visible with wrong faces or lighting.
import {
  BLOCK,
  BLOCK_INFO,
  IS_SOLID,
  IS_WATERLOGGED,
  IS_SELECTABLE,
  SHAPE_OF,
  SHAPE,
  TILE,
  BLOCK_BOX,
  isSupportedBy,
} from "./blocks.js";
import { Chunk } from "./chunk.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, blockIndex, floorDiv, chunkKey } from "./constants.js";
import { setEdit } from "./storage.js";
import { TerrainGenerator } from "./terrain.js";
import { LightEngine, sampleLight } from "./light.js";
import { meshChunk, padChunk } from "./mesher.js";
import { buildBlockTextures } from "./textures.js";
import { createChunkMaterials } from "./shaders.js";

export { SEA_LEVEL };

// Numeric chunk-map keys (much cheaper than strings in the hot paths).
const KEY_OFFSET = 1048576; // 2^20 chunks each way
function numKey(cx, cz) {
  return (cx + KEY_OFFSET) * 2097152 + (cz + KEY_OFFSET);
}

// A streaming plan that meshes every chunk within `r` chunks of the player
// (see World.ensureChunksAround), cached per distance.
const circlePlans = new Map();
function circlePlan(r) {
  let plan = circlePlans.get(r);
  if (!plan) {
    plan = { id: `circle:${r}`, reach: r, meshed: (cx, cz, dx, dz) => dx * dx + dz * dz <= r * r };
    circlePlans.set(r, plan);
  }
  return plan;
}

// Max filter of radius r over a W x W grid of 0/1 flags (square neighborhood).
function dilate(grid, W, r) {
  const tmp = new Uint8Array(W * W);
  const out = new Uint8Array(W * W);
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      if (!grid[z * W + x]) continue;
      for (let i = Math.max(0, x - r); i <= Math.min(W - 1, x + r); i++) tmp[z * W + i] = 1;
    }
  }
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      if (!tmp[z * W + x]) continue;
      for (let j = Math.max(0, z - r); j <= Math.min(W - 1, z + r); j++) out[j * W + x] = 1;
    }
  }
  return out;
}

// Selection boxes for non-cube shapes: [minX, minY, minZ, maxX, maxY, maxZ].
const SELECTION = {
  [SHAPE.CUBE]: [0, 0, 0, 1, 1, 1],
  [SHAPE.CROSS]: [0.15, 0, 0.15, 0.85, 0.8, 0.85],
  [SHAPE.TORCH]: [6 / 16, 0, 6 / 16, 10 / 16, 11 / 16, 10 / 16],
};

export function selectionBox(id) {
  return BLOCK_BOX[id] || SELECTION[SHAPE_OF[id]] || SELECTION[SHAPE.CUBE];
}

const EDIT_REMESH_AT_ONCE = 8; // chunks rebuilt immediately after an edit
const EDIT_REMESH_BUDGET_MS = 10; // extra per-frame time for rebuilding after huge edits

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.terrain = new TerrainGenerator(this.seed);
    this.chunks = new Map(); // numKey -> Chunk
    // Player/explosion edits on top of generated terrain, grouped per chunk:
    // Map<chunkKey string, Map<localBlockIndex, blockId>> (see storage.js).
    this.edits = new Map();
    this.dirtyEditChunks = new Set(); // chunk keys with edits not yet saved
    this.lodDirty = new Set(); // "cx,cz" of chunks edited while unloaded: the LOD tiles over them need a rebuild (lod.js)

    const { texture, reliefTexture, canvases, blockColors, facePalette } = buildBlockTextures();
    this.atlas = texture;
    this.relief = reliefTexture;
    this.tileCanvases = canvases;
    this.blockColors = blockColors; // blockId -> [r,g,b] sRGB 0-1
    this.facePalette = facePalette; // linear top/side colors per block (distant terrain)
    this.materials = createChunkMaterials(texture, TILE.water, reliefTexture);
    this.meshOptions = { fancyLeaves: false }; // see mesher.js; setMeshOptions() rebuilds
    this.light = new LightEngine(this);

    this._heightCache = new Map(); // see heightAt
    this.genQueue = []; // { cx, cz, dist }
    this.genQueued = new Set(); // numKeys
    this.meshQueue = []; // chunks awaiting their first mesh
    this.meshQueued = new Set();
    this.remeshQueue = new Set(); // rebuilds from background light changes (budgeted)
    this.editRemeshQueue = new Set(); // rebuilds from block edits (next frame, unbudgeted)
    // (firstMeshes: chunks meshed for the first time; lod.js redraws on those only)
    this.stats = { lastEditRemeshCount: 0, lastEditRemeshMs: 0, meshes: 0, firstMeshes: 0, generated: 0 };
    this._nb = new Array(9).fill(null);
    // (Perf) Chunk generation in workers (enableGenWorkers): the chunks being
    // generated there, and the finished ones waiting to be taken in.
    this._genWorkers = null;
    this._genInflight = new Map(); // numKey -> { cx, cz }
    this._genDone = []; // { cx, cz, blocks }
    this._genWanted = null; // (cx, cz) => bool: still in the current plan's generated area
    // (Perf) Meshing in the same workers (first meshes and background
    // rebuilds; an edit's rebuild stays here, for the next frame).
    this.meshInWorkers = true;
    this._meshInflight = new Map(); // token -> chunk
    this._meshDone = []; // { token, buffers }
    this._meshSeq = 0; // a chunk's _meshToken: the newest mesh asked for (older results are dropped)
    this._planCx = null;
    this._planCz = null;
    this._planId = null;
    this._meshSet = new Set(); // numKeys of the chunks the current plan meshes
    this._keep = null; // chunks the current plan keeps loaded
    this.keepChunk = null; // (chunk) => true to keep a chunk loaded outside the plan
    this.extraWanted = null; // (cx, cz) => true to generate a chunk outside the plan (requestGen)
    this.chunksHidden = false; // new chunks start hidden (the LOD system shows them)

    this.onEdit = null; // () => void, after any recorded edit
    this.onBlockPopped = null; // (x, y, z, id) when a torch/plant loses its support
    this.changeListeners = []; // fns called with (flat [x, y, z, ...]) after every edit batch
  }

  key(cx, cz) {
    return numKey(cx, cz);
  }

  getChunk(cx, cz) {
    return this.chunks.get(numKey(cx, cz));
  }

  // The terrain height of a column. Cached: long ray casts over unloaded
  // ground (distant UFO shots, hidden spawn tests, missiles) ask for
  // hundreds of columns, and the noise behind each one is not cheap.
  heightAt(wx, wz) {
    const key = (wx + 2097152) * 4194304 + (wz + 2097152);
    let h = this._heightCache.get(key);
    if (h === undefined) {
      if (this._heightCache.size > 300000) this._heightCache.clear();
      h = this.terrain.heightAt(wx, wz);
      this._heightCache.set(key, h);
    }
    return h;
  }

  getBlock(wx, wy, wz) {
    if (wy < 0) return BLOCK.BEDROCK;
    if (wy >= WORLD_HEIGHT) return BLOCK.AIR;
    wx = Math.floor(wx);
    wz = Math.floor(wz);
    const chunk = this.chunks.get(numKey(wx >> 4, wz >> 4));
    if (!chunk) return BLOCK.AIR;
    return chunk.blocks[(Math.floor(wy) << 8) | ((wz & 15) << 4) | (wx & 15)];
  }

  isSolidAt(wx, wy, wz) {
    return IS_SOLID[this.getBlock(wx, wy, wz)] === 1;
  }

  // Light at a block position: { sky, block } (0-15).
  lightAt(wx, wy, wz) {
    return sampleLight(this, Math.floor(wx), Math.floor(wy), Math.floor(wz));
  }

  // Highest y whose block is solid in column (wx, wz), or -1.
  surfaceY(wx, wz) {
    // (one chunk lookup for the column, not one per block)
    wx = Math.floor(wx);
    wz = Math.floor(wz);
    const c = this.chunks.get(numKey(wx >> 4, wz >> 4));
    if (!c) return -1;
    const col = ((wz & 15) << 4) | (wx & 15);
    const b = c.blocks;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) if (IS_SOLID[b[(y << 8) | col]] === 1) return y;
    return -1;
  }

  setBlock(wx, wy, wz, id, opts) {
    return this.setBlocks([wx, wy, wz, id], opts) > 0;
  }

  // Like setBlock, but also works for a column whose chunk hasn't generated
  // yet: the edit is simply recorded (like a saved edit) and applied
  // automatically once that chunk streams in. Used for explosions that land
  // beyond the loaded terrain, out in distant/LOD ground.
  queueEdit(x, y, z, id) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = x >> 4;
    const cz = z >> 4;
    if (this.getChunk(cx, cz)) {
      this.setBlocks([x, y, z, id]);
      return;
    }
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    setEdit(this.edits, cx, cz, blockIndex(lx, y, lz), id);
    this.dirtyEditChunks.add(chunkKey(cx, cz));
    // (The distant terrain tiles over it must be rebuilt too: a crater far out
    // shows in the LOD terrain, see lod.js.)
    this.lodDirty.add(`${cx},${cz}`);
    if (this.onEdit) this.onEdit();
  }

  // Bulk edit: `list` is a flat [x, y, z, id, ...] array. Blocks in unloaded
  // chunks are skipped. Torches/plants left without support pop off. Light
  // is updated once for the whole batch, and every affected chunk (plus
  // border neighbors) is queued for a rebuild. Returns the number of blocks
  // that actually changed.
  // remote: edits that came from another player online (js/net/world.js): the
  // player who made them already ran water flow, falling sand and the like,
  // and their results arrive as edits of their own.
  setBlocks(list, { recordEdit = true, remote = false } = {}) {
    const changed = [];
    const apply = (x, y, z, id) => {
      if (y < 0 || y >= WORLD_HEIGHT) return false;
      const chunk = this.getChunk(x >> 4, z >> 4);
      if (!chunk) return false;
      const lx = x & 15;
      const lz = z & 15;
      const idx = blockIndex(lx, y, lz);
      // Removing a waterlogged plant (seagrass, kelp) leaves its water behind.
      if (id === BLOCK.AIR && IS_WATERLOGGED[chunk.blocks[idx]]) id = BLOCK.WATER;
      if (chunk.blocks[idx] === id) return false;
      chunk.blocks[idx] = id;
      changed.push(x, y, z);
      if (recordEdit) {
        setEdit(this.edits, chunk.cx, chunk.cz, idx, id);
        this.dirtyEditChunks.add(chunk.key);
      }
      this._queueEditRemesh(chunk, lx, lz);
      return true;
    };
    for (let i = 0; i < list.length; i += 4) apply(Math.floor(list[i]), Math.floor(list[i + 1]), Math.floor(list[i + 2]), list[i + 3]);
    // Blocks that needed support from a block that just changed pop off.
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const y = changed[i + 1] + 1;
      const z = changed[i + 2];
      const above = this.getBlock(x, y, z);
      if (BLOCK_INFO[above]?.support && !isSupportedBy(above, this.getBlock(x, y - 1, z))) {
        if (apply(x, y, z, BLOCK.AIR) && this.onBlockPopped && !remote) this.onBlockPopped(x, y, z, above);
      }
    }
    if (changed.length === 0) return 0;
    // (A chunk whose first mesh is still in a worker counts as meshed: that
    // mesh predates the change, and the rebuild here replaces it.)
    for (const c of this.light.applyChanges(changed)) {
      if (c.meshed || this._meshing(c)) this.editRemeshQueue.add(c);
    }
    if (recordEdit && this.onEdit) this.onEdit();
    for (const fn of this.changeListeners) fn(changed, { recordEdit, remote });
    return changed.length / 3;
  }

  _queueEditRemesh(chunk, lx, lz) {
    if (chunk.meshed || this._meshing(chunk)) this.editRemeshQueue.add(chunk);
    const dx = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (dx === 0 && dz === 0) return;
    const add = (cx, cz) => {
      const n = this.getChunk(cx, cz);
      if (n && (n.meshed || this._meshing(n))) this.editRemeshQueue.add(n);
    };
    if (dx) add(chunk.cx + dx, chunk.cz);
    if (dz) add(chunk.cx, chunk.cz + dz);
    if (dx && dz) add(chunk.cx + dx, chunk.cz + dz);
  }

  // ---------- Streaming ----------

  // Plans chunk loading/unloading around the player. `plan` says which
  // chunks get meshes: either a render distance (every chunk within it), or
  // { id, reach, meshed(cx, cz, dx, dz) } from the LOD system (dx, dz: the
  // offset from the player's chunk) (the detailed area
  // around the player; `reach` bounds it in chunks, and `id` changes
  // whenever the area does). The 8 neighbors of every meshed chunk are
  // generated as well, and chunks farther than 3 from any meshed chunk are
  // unloaded (unless keepChunk(chunk) still wants them). Cheap to call every
  // frame: re-planning only runs when the player crosses into another chunk
  // or the plan changes.
  ensureChunksAround(px, pz, plan) {
    if (typeof plan === "number") plan = circlePlan(plan);
    const pcx = floorDiv(px, CHUNK_SIZE);
    const pcz = floorDiv(pz, CHUNK_SIZE);
    if (pcx === this._planCx && pcz === this._planCz && plan.id === this._planId) return;
    this._planCx = pcx;
    this._planCz = pcz;
    this._planId = plan.id;

    // Flags on a square grid around the player: meshed, generated (meshed
    // dilated by 1), kept (meshed dilated by 3).
    const R = Math.ceil(plan.reach) + 3;
    const W = 2 * R + 1;
    const meshed = new Uint8Array(W * W);
    this._meshSet = new Set();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > (plan.reach + 1) * (plan.reach + 1)) continue;
        if (!plan.meshed(pcx + dx, pcz + dz, dx, dz)) continue;
        meshed[(dz + R) * W + (dx + R)] = 1;
        this._meshSet.add(numKey(pcx + dx, pcz + dz));
      }
    }
    const data = dilate(meshed, W, 1);
    const keep = dilate(meshed, W, 3);
    const flag = (grid, cx, cz) => {
      const dx = cx - pcx;
      const dz = cz - pcz;
      return dx >= -R && dx <= R && dz >= -R && dz <= R && grid[(dz + R) * W + (dx + R)] === 1;
    };
    this._keep = { grid: keep, flag };
    const dist2 = (cx, cz) => (cx - pcx) * (cx - pcx) + (cz - pcz) * (cz - pcz);

    // (chunks asked for outside the plan by requestGen stay wanted too)
    this._genWanted = (cx, cz) => flag(data, cx, cz) || !!this.extraWanted?.(cx, cz);
    this.genQueue = this.genQueue.filter((e) => {
      e.dist = dist2(e.cx, e.cz);
      if (!this._genWanted(e.cx, e.cz)) {
        this.genQueued.delete(numKey(e.cx, e.cz));
        return false;
      }
      return true;
    });
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (data[(dz + R) * W + (dx + R)] !== 1) continue;
        const k = numKey(pcx + dx, pcz + dz);
        if (!this.chunks.has(k) && !this.genQueued.has(k) && !this._genInflight.has(k)) {
          this.genQueue.push({ cx: pcx + dx, cz: pcz + dz, dist: dx * dx + dz * dz });
          this.genQueued.add(k);
        }
      }
    }
    this.genQueue.sort((a, b) => a.dist - b.dist);

    this.releaseChunks();

    // Rebuild the mesh queue: ready, unmeshed chunks in the meshed area, nearest first.
    this.meshQueue = [];
    this.meshQueued.clear();
    for (const chunk of this.chunks.values()) {
      if (!chunk.meshed && !this._meshing(chunk) && this._meshSet.has(numKey(chunk.cx, chunk.cz)) && this._isReady(chunk)) {
        this.meshQueue.push(chunk);
        this.meshQueued.add(chunk);
      }
    }
    this.meshQueue.sort((a, b) => dist2(a.cx, a.cz) - dist2(b.cx, b.cz));
  }

  // Queues one chunk outside the plan for generation (in the workers when
  // they run; extraWanted must keep wanting it, or it is dropped).
  requestGen(cx, cz) {
    const k = numKey(cx, cz);
    if (this.chunks.has(k) || this.genQueued.has(k) || this._genInflight.has(k)) return;
    this.genQueue.push({ cx, cz, dist: this._planCx === null ? 0 : (cx - this._planCx) ** 2 + (cz - this._planCz) ** 2 });
    this.genQueued.add(k);
  }

  // Unloads chunks well outside the meshed area (unless keepChunk still
  // wants them, e.g. while they stand in for distant terrain being built).
  releaseChunks() {
    if (!this._keep) return 0;
    const { grid, flag } = this._keep;
    let n = 0;
    for (const [k, chunk] of this.chunks) {
      if (flag(grid, chunk.cx, chunk.cz) || (this.keepChunk && this.keepChunk(chunk))) continue;
      this.scene.remove(chunk.group);
      chunk.dispose();
      this.chunks.delete(k);
      this.remeshQueue.delete(chunk);
      this.editRemeshQueue.delete(chunk);
      n++;
    }
    return n;
  }

  // Changes how chunks are meshed (e.g. fancy leaves) and queues every
  // meshed chunk for a rebuild (spread over frames by processQueues).
  setMeshOptions(options) {
    const next = { ...this.meshOptions, ...options };
    if (Object.keys(next).every((k) => next[k] === this.meshOptions[k])) return;
    this.meshOptions = next;
    for (const chunk of this.chunks.values()) {
      if (chunk.meshed) this.remeshQueue.add(chunk);
      else if (this._meshing(chunk)) {
        // (a first mesh in a worker with the old options: dropped, made again)
        chunk._meshToken = 0;
        this.meshQueue.unshift(chunk);
        this.meshQueued.add(chunk);
      }
    }
  }

  // True if the current plan wants chunk (cx, cz) meshed.
  wantsMesh(cx, cz) {
    return this._meshSet.has(numKey(cx, cz));
  }

  _isReady(chunk) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!this.chunks.has(numKey(chunk.cx + dx, chunk.cz + dz))) return false;
      }
    }
    return true;
  }

  _dist2(chunk) {
    const dx = chunk.cx - this._planCx;
    const dz = chunk.cz - this._planCz;
    return dx * dx + dz * dz;
  }

  _inMeshRange(chunk) {
    return this._meshSet.has(numKey(chunk.cx, chunk.cz));
  }

  // Generates and meshes queued chunks until `budgetMs` of main-thread time
  // has been spent this frame (always at least one unit of work if any is
  // pending). Chunks changed by block edits are rebuilt first and without a
  // budget, so the player sees their own edits immediately.
  processQueues(budgetMs = 4) {
    const start = performance.now();
    if (this.editRemeshQueue.size > 0) {
      // Everyday edits (a few chunks) rebuild at once. A huge blast touches
      // dozens of chunks: those are spread over several frames, nearest
      // first, within a time budget.
      let list = [...this.editRemeshQueue];
      if (list.length > EDIT_REMESH_AT_ONCE) list.sort((a, b) => this._dist2(a) - this._dist2(b));
      let n = 0;
      for (const chunk of list) {
        if (n >= EDIT_REMESH_AT_ONCE && performance.now() - start > EDIT_REMESH_BUDGET_MS) break;
        if (this.chunks.get(numKey(chunk.cx, chunk.cz)) === chunk) this._buildMesh(chunk);
        this.editRemeshQueue.delete(chunk);
        n++;
      }
      list = null;
      this.stats.lastEditRemeshCount = n;
      this.stats.lastEditRemeshMs = performance.now() - start;
      if (this.editRemeshQueue.size > 0) this.stats.spreadRemeshFrames = (this.stats.spreadRemeshFrames || 0) + 1;
    }

    // (Perf) With workers, generation runs there: keep them fed (nearest
    // first) and take the finished chunks in below, within the budget.
    const workers = this._genWorkers && this._genWorkers.length ? this._dispatchGen() : false;
    const meshW = workers && this.meshInWorkers;
    let didWork = false;
    // Meshes made in the workers: into the scene.
    while (this._meshDone.length > 0 && (!didWork || performance.now() - start < budgetMs)) {
      this._applyMeshResult(this._meshDone.shift());
      didWork = true;
    }
    while (!didWork || performance.now() - start < budgetMs) {
      // Drop stale mesh-queue entries (already meshed or unloaded).
      while (this.meshQueue.length > 0) {
        const c = this.meshQueue[0];
        if (!c.meshed && this.chunks.get(numKey(c.cx, c.cz)) === c) break;
        this.meshQueued.delete(this.meshQueue.shift());
      }
      // Finished chunks no longer wanted (the player moved on) or made
      // meanwhile on the main thread (prepareArea) are dropped.
      while (this._genDone.length > 0) {
        const r = this._genDone[0];
        if (!this.chunks.has(numKey(r.cx, r.cz)) && (!this._genWanted || this._genWanted(r.cx, r.cz))) break;
        this._genDone.shift();
      }
      const nextMesh = this.meshQueue[0];
      const done = this._genDone[0];
      const nextGen = workers ? null : this.genQueue[0];
      const genDist = done ? this._dist2(done) : nextGen ? nextGen.dist : Infinity;
      const meshSlot = !meshW || this._meshSlot();
      // Prefer meshing nearby ready chunks over generating farther ones.
      if (nextMesh && meshSlot && this._dist2(nextMesh) <= genDist + 2) {
        this.meshQueue.shift();
        if (meshW) this._dispatchMesh(nextMesh, meshSlot);
        else this._buildMesh(nextMesh);
      } else if (done) {
        this._genDone.shift();
        this._generate(done.cx, done.cz, done.blocks);
      } else if (nextGen) {
        this.genQueue.shift();
        this.genQueued.delete(numKey(nextGen.cx, nextGen.cz));
        this._generate(nextGen.cx, nextGen.cz);
      } else if (this.remeshQueue.size > 0 && meshSlot) {
        const chunk = this.remeshQueue.values().next().value;
        this.remeshQueue.delete(chunk);
        if (chunk.meshed || this._meshing(chunk)) {
          if (meshW) this._dispatchMesh(chunk, meshSlot);
          else this._buildMesh(chunk);
        }
      } else {
        break;
      }
      didWork = true;
    }
  }

  // (Perf) Moves chunk generation (about half of the streaming work) into
  // `n` workers running the same generator (chunk-worker.js). Main-thread
  // generation stays for prepareArea and as the fallback: if a worker can't
  // start or fails, everything goes back to the main thread as before.
  enableGenWorkers(n) {
    if (typeof Worker === "undefined" || n < 1) return false;
    try {
      this._genWorkers = [];
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL("./chunk-worker.js", import.meta.url), { type: "module" });
        w.busy = 0;
        w.meshBusy = 0;
        w.onmessage = (e) => {
          const m = e.data;
          if (m && m.type === "mesh") {
            w.meshBusy = Math.max(0, w.meshBusy - 1);
            this._meshDone.push(m);
            return;
          }
          if (!m || m.type !== "chunk") return;
          w.busy = Math.max(0, w.busy - 1);
          this._genInflight.delete(numKey(m.cx, m.cz));
          this._genDone.push(m);
        };
        w.onerror = (e) => {
          if (e && e.preventDefault) e.preventDefault();
          this._stopGenWorkers();
        };
        w.postMessage({ type: "init", seed: this.seed });
        this._genWorkers.push(w);
      }
      return true;
    } catch (err) {
      this._stopGenWorkers();
      return false;
    }
  }

  // True while workers do the generating.
  get genInWorkers() {
    return !!(this._genWorkers && this._genWorkers.length);
  }

  // Back to main-thread generation: the chunks that were in a worker are queued again.
  _stopGenWorkers() {
    for (const w of this._genWorkers || []) w.terminate();
    this._genWorkers = null;
    for (const [k, { cx, cz }] of this._genInflight) {
      if (this.chunks.has(k) || this.genQueued.has(k)) continue;
      this.genQueue.push({ cx, cz, dist: this._planCx === null ? 0 : (cx - this._planCx) ** 2 + (cz - this._planCz) ** 2 });
      this.genQueued.add(k);
    }
    this._genInflight.clear();
    this.genQueue.sort((a, b) => a.dist - b.dist);
    // The meshes that were in a worker: made again here.
    for (const chunk of this._meshInflight.values()) {
      if (this.chunks.get(numKey(chunk.cx, chunk.cz)) !== chunk) continue;
      chunk._meshToken = 0;
      if (chunk.meshed) this.remeshQueue.add(chunk);
      else if (this._inMeshRange(chunk)) {
        this.meshQueue.push(chunk);
        this.meshQueued.add(chunk);
      }
    }
    this._meshInflight.clear();
  }

  // True while a worker meshes the chunk (its newest mesh asked for).
  _meshing(chunk) {
    return !!chunk._meshToken && this._meshInflight.has(chunk._meshToken);
  }

  // The worker to mesh in (the least busy, if it has room), or null.
  _meshSlot() {
    const ws = this._genWorkers;
    let w = ws[0];
    for (const x of ws) if (x.meshBusy < w.meshBusy) w = x;
    return w.meshBusy < 3 ? w : null;
  }

  // Takes the chunk's padded volume (see mesher.js) and has worker `w` mesh it.
  _dispatchMesh(chunk, w) {
    const nb = this._nb;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) nb[(dz + 1) * 3 + (dx + 1)] = this.chunks.get(numKey(chunk.cx + dx, chunk.cz + dz)) || null;
    }
    const p = padChunk(nb);
    const token = ++this._meshSeq;
    chunk._meshToken = token;
    this._meshInflight.set(token, chunk);
    this.remeshQueue.delete(chunk); // (a light change after this queues it again)
    w.meshBusy++;
    w.postMessage({ type: "mesh", token, cx: chunk.cx, cz: chunk.cz, maxY: p.maxY, fancy: this.meshOptions.fancyLeaves, blocks: p.blocks, light: p.light }, [p.blocks.buffer, p.light.buffer]);
  }

  // A worker's mesh: applied unless the chunk is gone or a newer mesh was asked for.
  _applyMeshResult(m) {
    const chunk = this._meshInflight.get(m.token);
    this._meshInflight.delete(m.token);
    if (!chunk || chunk._meshToken !== m.token) return;
    if (this.chunks.get(numKey(chunk.cx, chunk.cz)) !== chunk) {
      this.meshQueued.delete(chunk);
      return;
    }
    chunk.applyMesh(m.buffers, this.materials);
    if (!chunk.meshed) this.stats.firstMeshes++;
    chunk.meshed = true;
    chunk.meshCount = (chunk.meshCount || 0) + 1;
    this.meshQueued.delete(chunk);
    this.stats.meshes++;
  }

  // Hands the nearest queued chunks to the workers (a few each, so they never
  // wait on a slow frame). True while workers do the generating.
  _dispatchGen() {
    const ws = this._genWorkers;
    const perWorker = 3;
    while (this.genQueue.length > 0) {
      let w = ws[0];
      for (const x of ws) if (x.busy < w.busy) w = x;
      if (w.busy >= perWorker) break;
      const e = this.genQueue.shift();
      const k = numKey(e.cx, e.cz);
      this.genQueued.delete(k);
      if (this.chunks.has(k) || this._genInflight.has(k)) continue;
      this._genInflight.set(k, { cx: e.cx, cz: e.cz });
      w.busy++;
      w.postMessage({ type: "gen", cx: e.cx, cz: e.cz });
    }
    return true;
  }

  // Synchronously generates (radius r + 1) and meshes (radius r) the chunks
  // around a world position, so the player can be placed there right away
  // (at startup, or when respawning far from where they died).
  prepareArea(wx, wz, r = 2) {
    const pcx = floorDiv(Math.floor(wx), CHUNK_SIZE);
    const pcz = floorDiv(Math.floor(wz), CHUNK_SIZE);
    for (let dz = -r - 1; dz <= r + 1; dz++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) this._generate(pcx + dx, pcz + dz);
    }
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const chunk = this.getChunk(pcx + dx, pcz + dz);
        if (chunk && (!chunk.meshed || this.remeshQueue.has(chunk))) this._buildMesh(chunk);
      }
    }
  }

  // True once every chunk within the render distance is generated and meshed.
  get isIdle() {
    // (chunks in the generation workers, or back from them and not yet taken in, count too)
    return this.genQueue.length === 0 && this._genInflight.size === 0 && this._genDone.length === 0 && this.meshQueue.length === 0 && this.editRemeshQueue.size === 0 && this._meshInflight.size === 0 && this._meshDone.length === 0;
  }

  // (blocks: generated by a worker; else generated here.)
  _generate(cx, cz, blocks = null) {
    const k = numKey(cx, cz);
    if (this.chunks.has(k)) return;
    const chunk = new Chunk(cx, cz, blocks);
    if (!blocks) this.terrain.generate(chunk);
    this.applyStoredEdits(chunk);
    this.chunks.set(k, chunk);
    chunk.generated = true;
    this.stats.generated++;
    for (const c of this.light.initChunk(chunk)) {
      if (c.meshed || this._meshing(c)) this.remeshQueue.add(c);
    }
    if (this.chunksHidden) chunk.group.visible = false;
    this.scene.add(chunk.group);
    // (Round 8: a nuke's blast zone reaching this chunk is applied now: see nuke.js.)
    this.onChunkGenerated?.(chunk);
    // This chunk, or a neighbor that was waiting on it, may now be meshable.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(numKey(cx + dx, cz + dz));
        if (n && !n.meshed && !this.meshQueued.has(n) && !this._meshing(n) && this._inMeshRange(n) && this._isReady(n)) {
          this.meshQueue.push(n);
          this.meshQueued.add(n);
        }
      }
    }
  }

  _buildMesh(chunk) {
    const nb = this._nb;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) nb[(dz + 1) * 3 + (dx + 1)] = this.chunks.get(numKey(chunk.cx + dx, chunk.cz + dz)) || null;
    }
    chunk.applyMesh(meshChunk(nb, this.meshOptions), this.materials);
    chunk._meshToken = ++this._meshSeq; // (a mesh still in a worker is older: dropped)
    if (!chunk.meshed) this.stats.firstMeshes++;
    chunk.meshed = true;
    chunk.meshCount = (chunk.meshCount || 0) + 1; // lets caches of chunk contents (grass.js) notice rebuilds
    this.meshQueued.delete(chunk);
    this.remeshQueue.delete(chunk);
    this.stats.meshes++;
  }

  applyStoredEdits(chunk) {
    const map = this.edits.get(chunk.key);
    if (!map) return;
    for (const [index, id] of map) chunk.blocks[index] = id;
  }

  // Replaces the in-memory edits with ones loaded from storage (called before
  // any chunk is generated, so they're applied as chunks stream in).
  loadEdits(edits) {
    this.edits = edits;
  }

  // Block id at (x, y, z) for ray casting: the real block where its chunk is
  // loaded, otherwise an approximate solid/air guess from the deterministic
  // height map (so hitscan weapons and projectiles can still hit distant,
  // unloaded/LOD terrain instead of sailing through it forever).
  _castBlock(x, y, z, heightfield) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;
    const chunk = this.getChunk(x >> 4, z >> 4);
    if (chunk) return chunk.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
    if (!heightfield) return BLOCK.AIR;
    return y <= this.heightAt(x, z) ? BLOCK.STONE : BLOCK.AIR;
  }

  // Voxel traversal ray cast (Amanatides & Woo). Returns
  // { block: [x,y,z], place: [x,y,z], normal: [x,y,z], id, distance } for
  // the first selectable block (non-cube blocks use their selection box), or null.
  // solidOnly: pass through non-solid blocks (plants, torches), e.g. for bullets.
  // heightfield: beyond loaded terrain, hit-test against the height map
  // instead of always passing through (on by default; block-placement/mining
  // reach never needs it since it never sees unloaded chunks).
  raycast(origin, direction, maxDistance = 6, { solidOnly = false, heightfield = true } = {}) {
    const dir = direction.clone().normalize();
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.y > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? (stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX : Infinity;
    let tMaxY = dir.y !== 0 ? (stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY : Infinity;
    let tMaxZ = dir.z !== 0 ? (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ : Infinity;
    let axis = -1; // the axis of the last step (the normal is built only for a hit: a long cast takes thousands of steps)
    let t = 0;
    while (t <= maxDistance) {
      const id = this._castBlock(x, y, z, heightfield);
      if (IS_SELECTABLE[id] && (!solidOnly || IS_SOLID[id])) {
        const hitT = SHAPE_OF[id] === SHAPE.CUBE ? t : rayBox(origin, dir, x, y, z, selectionBox(id));
        if (hitT !== null && hitT <= maxDistance) {
          const n = axis === 0 ? [-stepX, 0, 0] : axis === 1 ? [0, -stepY, 0] : axis === 2 ? [0, 0, -stepZ] : [0, 0, 0];
          return {
            block: [x, y, z],
            place: axis >= 0 ? [x + n[0], y + n[1], z + n[2]] : [x, y, z],
            normal: n,
            id,
            distance: hitT,
          };
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        axis = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        axis = 1;
        if (y >= WORLD_HEIGHT && stepY > 0) return null; // (gone out of the top: nothing more to hit)
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        axis = 2;
      }
    }
    return null;
  }
}

// Ray vs. an axis-aligned box inside block (bx, by, bz); returns the entry t or null.
function rayBox(origin, dir, bx, by, bz, box) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [bx + box[0], by + box[1], bz + box[2]];
  const hi = [bx + box[3], by + box[4], bz + box[5]];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    let t1 = (lo[a] - o[a]) / d[a];
    let t2 = (hi[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
