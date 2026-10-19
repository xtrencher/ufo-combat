// The nether portal (Round 12), as vanilla Java 1.20's, and the Nether's
// block rules that need the world (the portal's, soul fire's, weeping
// vines', the respawn anchor's), built on the dimension engine
// (js/dimensions.js: its travel, the portals' registry, the 4 s wait).
//
// - Lighting: a fire (flint and steel, a fire charge, spreading fire, lava)
//   in an obsidian frame of 2 x 3 to 21 x 21 inside (the corners don't
//   matter) fills it with portal blocks along the frame's plane (vanilla's
//   PortalShape); the portal is registered (dims.addPortal) for travellers
//   to find. A fire lit on soul sand or soul soil becomes soul fire.
// - Breaking: when a frame block or a portal block goes (mined,
//   blown up, replaced), every portal block of that portal goes, and its
//   registration with it.
// - Travel (dims.portalLinks.nether): standing in it 4 s (at once in
//   Creative: the engine's wait) takes you to the other dimension at x/8,
//   z/8 (x8 back); the nearest registered portal within 128 blocks (the
//   Overworld) or 16 (the Nether) of that spot is where you come out, else
//   a new portal is built: on the nearest spot within 16 blocks where its
//   4 x 5 frame stands on solid ground with room in front and behind, else
//   on a 3 x 2 obsidian platform at y 70 or the spot's height (vanilla's
//   rule; in the Overworld on its ground's top, or just over the sea: this
//   world's sea is at 24), registered for the way back. You come out
//   standing in it (step out before it works again).
// - On screen: purple motes round portals, the portal's hum near one, the
//   swirl closing in while you wait in it (the engine's overlay, turning
//   here), the trigger and travel sounds.
// - Weeping vines hang from the block above: when it goes, they come down.
// - The respawn anchor (js/content/nether.js charges it): used charged in
//   the Nether it is the spawn point (sleep.spawn with spawnDim "nether",
//   one charge used at each respawn there), anywhere else it explodes like a
//   bed in the Nether (power 5, fire).
// Online every change is an ordinary block edit made by the peer whose edit
// started it (another peer's edits arrive with their results): the portal
// blocks, frames and anchors are shared in their dimension; each player
// travels on their own; the registry is the engine's (shared by the host).
import { PORTAL_BLOCKS, NETHER, OVERWORLD, END } from "./dim-registry.js";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_OPAQUE, IS_REPLACEABLE } from "./blocks.js";
import { LIB } from "./content/base.js";
import * as I from "./content/ids.js";
import { isNetherPortal, isSoulFireBase, isWeepingVines, anchorCharge } from "./content/nether.js";
import { isLava } from "./content/nature.js";
import { WORLD_HEIGHT, SEA_LEVEL } from "./constants.js";

PORTAL_BLOCKS.set(I.NETHER_PORTAL, "nether");
PORTAL_BLOCKS.set(I.NETHER_PORTAL + 1, "nether");

export const PORTAL_MIN_W = 2;
export const PORTAL_MAX_W = 21;
export const PORTAL_MIN_H = 3;
export const PORTAL_MAX_H = 21;
const SEARCH_BUILD = 16; // (vanilla: a new portal within 16 blocks of the spot)
const MOTE = { r: 1.6, g: 0.5, b: 3.2 };
const MOTE_END = { r: 0.5, g: 0.1, b: 1.2 };

const isFrame = (id) => id === I.OBSIDIAN;
const isInside = (id) => id === BLOCK.AIR || id === I.FIRE || id === I.SOUL_FIRE || isNetherPortal(id);
const AXIS = [
  [1, 0],
  [0, 1],
];

// Vanilla's PortalShape: the portal whose inside holds (x, y, z), its plane
// along x (axis 0) or z (1): { axis, x, y, z (its bottom-left inside cell),
// w, h, portals (how many inside cells are portal blocks of that axis) }, or null.
export function findPortalShape(getBlock, x, y, z, axis) {
  const [dx, dz] = AXIS[axis];
  if (!isInside(getBlock(x, y, z))) return null;
  let by = y;
  for (let k = 0; k < PORTAL_MAX_H && by > 1 && isInside(getBlock(x, by - 1, z)); k++) by--;
  if (!isFrame(getBlock(x, by - 1, z))) return null;
  // (the left edge: along -axis while the cell is open over frame)
  let lx = x;
  let lz = z;
  for (let n = 0; n < PORTAL_MAX_W && isInside(getBlock(lx - dx, by, lz - dz)) && isFrame(getBlock(lx - dx, by - 1, lz - dz)); n++) {
    lx -= dx;
    lz -= dz;
  }
  if (!isFrame(getBlock(lx - dx, by, lz - dz))) return null;
  let w = 0;
  while (w <= PORTAL_MAX_W && isInside(getBlock(lx + dx * w, by, lz + dz * w)) && isFrame(getBlock(lx + dx * w, by - 1, lz + dz * w))) w++;
  if (w < PORTAL_MIN_W || w > PORTAL_MAX_W || !isFrame(getBlock(lx + dx * w, by, lz + dz * w))) return null;
  let h = 0;
  let portals = 0;
  rows: for (; h <= PORTAL_MAX_H; h++) {
    const yy = by + h;
    if (yy >= WORLD_HEIGHT - 1) return null;
    for (let i = 0; i < w; i++) {
      const id = getBlock(lx + dx * i, yy, lz + dz * i);
      if (!isInside(id)) break rows;
      if (id === I.NETHER_PORTAL + axis) portals++;
    }
    if (!isFrame(getBlock(lx - dx, yy, lz - dz)) || !isFrame(getBlock(lx + dx * w, yy, lz + dz * w))) return null;
  }
  if (h < PORTAL_MIN_H || h > PORTAL_MAX_H) return null;
  for (let i = 0; i < w; i++) if (!isFrame(getBlock(lx + dx * i, by + h, lz + dz * i))) return null;
  return { axis, x: lx, y: by, z: lz, w, h, portals };
}

// The inside cells of a shape: [x, y, z, ...].
export function shapeCells(s) {
  const [dx, dz] = AXIS[s.axis];
  const out = [];
  for (let h = 0; h < s.h; h++) for (let i = 0; i < s.w; i++) out.push(s.x + dx * i, s.y + h, s.z + dz * i);
  return out;
}

export class NetherPortals {
  // game: main.js's game object (world, player, audio, effects, sleep, toast); dims: the DimensionManager.
  constructor(game, dims) {
    this.game = game;
    this.dims = dims;
    this.world = game.world;
    this.player = game.player;
    this._queue = new Set(); // "x,y,z" of cells an edit of ours changed (looked at next frame)
    this._ambT = 2;
    this._moteT = 0;
    this._near = []; // portal cells near the player (motes, the hum)
    this._scanT = 0;
    this._waiting = 0;
    this.stats = { lit: 0, broken: 0, built: 0 };
    this.world.changeListeners?.push((changed, opts) => this._edited(changed, opts));
    if (!dims) return;
    dims.portalLinks.nether = {
      find: (dim, x, y, z, r, d) => d.nearestPortal(dim, x, y, z, r),
      arrive: (dim, x, y, z, found) => this.arrive(dim, x, y, z, found),
    };
    this._hookSpawn();
    LIB.useRespawnAnchor = (ctx) => this.useAnchor(ctx);
    LIB.lightPortalAt = (world, x, y, z) => world === this.world && this.tryLight(x, y, z);
    if (!LIB.toast && game.toast) LIB.toast = (text, s) => game.toast(text, s);
  }

  // ---------- Edits ----------

  // (Every edit batch: ours are looked at next frame; another peer's come
  // with the results of their own look.)
  _edited(changed, opts) {
    if (opts?.remote) return;
    const q = this._queue;
    if (changed.length > 3 * 4096) return; // (a whole area replaced: a reload, not a player)
    for (let i = 0; i < changed.length; i += 3) q.add(`${changed[i]},${changed[i + 1]},${changed[i + 2]}`);
  }

  _flush() {
    if (!this._queue.size) return;
    const w = this.world;
    const cells = [...this._queue].map((k) => k.split(",").map(Number));
    this._queue.clear();
    const get = (x, y, z) => w.getBlock(x, y, z);
    const checked = new Set();
    for (const [x, y, z] of cells) {
      if (!w.getChunk(x >> 4, z >> 4)) continue;
      const id = get(x, y, z);
      // A fire: in a frame, the portal; on soul sand or soil, soul fire.
      if (id === I.FIRE || id === I.SOUL_FIRE) {
        if (this.tryLight(x, y, z)) continue;
        if (id === I.FIRE && isSoulFireBase(get(x, y - 1, z))) w.setBlock(x, y, z, I.SOUL_FIRE);
        continue;
      }
      // A cell that is no longer a portal or a frame: the portals beside it checked.
      if (!isNetherPortal(id)) {
        for (const [dx, dy, dz] of SIX) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          const n = get(nx, ny, nz);
          if (!isNetherPortal(n)) continue;
          const key = `${nx},${ny},${nz}`;
          if (checked.has(key)) continue;
          checked.add(key);
          this._check(nx, ny, nz, n - I.NETHER_PORTAL, checked);
        }
      }
      // Weeping vines hanging from it come down when it can't hold them.
      const below = get(x, y - 1, z);
      if (isWeepingVines(below) && !weepingHolds(id)) this._dropVines(x, y - 1, z);
    }
  }

  // Lights the portal round a fire at (x, y, z), if it is in a frame. True if lit.
  tryLight(x, y, z) {
    // (a Missions world never reaches the Nether: its frames stay frames;
    // nor do they light in the End, as vanilla's)
    if (!this.dims?.enabled || this.dims.dim === END) return false;
    const w = this.world;
    const get = (bx, by, bz) => w.getBlock(bx, by, bz);
    for (const axis of [0, 1]) {
      const s = findPortalShape(get, x, y, z, axis);
      if (!s || s.portals) continue;
      const list = [];
      const cells = shapeCells(s);
      for (let i = 0; i < cells.length; i += 3) list.push(cells[i], cells[i + 1], cells[i + 2], I.NETHER_PORTAL + axis);
      w.setBlocks(list);
      this.dims?.addPortal(this.dims.dim, s.x, s.y, s.z);
      this.stats.lit++;
      this._sound("light", x, y, z);
      return true;
    }
    return false;
  }

  // Whether the portal block at (x, y, z) still has its whole portal; if not, the portal goes.
  _check(x, y, z, axis, checked) {
    const w = this.world;
    const get = (bx, by, bz) => w.getBlock(bx, by, bz);
    const s = findPortalShape(get, x, y, z, axis);
    if (s && s.portals === s.w * s.h) {
      for (let i = 0, c = shapeCells(s); i < c.length; i += 3) checked.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
      return;
    }
    // (the whole connected sheet of this plane's portal blocks)
    const [dx, dz] = AXIS[axis];
    const id = I.NETHER_PORTAL + axis;
    const seen = new Set([`${x},${y},${z}`]);
    const stack = [[x, y, z]];
    const list = [];
    while (stack.length && list.length < 4 * 441) {
      const [cx, cy, cz] = stack.pop();
      list.push(cx, cy, cz, BLOCK.AIR);
      for (const [ox, oy, oz] of [[dx, 0, dz], [-dx, 0, -dz], [0, 1, 0], [0, -1, 0]]) {
        const nx = cx + ox;
        const ny = cy + oy;
        const nz = cz + oz;
        const k = `${nx},${ny},${nz}`;
        if (seen.has(k) || get(nx, ny, nz) !== id) continue;
        seen.add(k);
        stack.push([nx, ny, nz]);
      }
    }
    for (const k of seen) checked.add(k);
    w.setBlocks(list);
    this.stats.broken++;
    // (its registration: any registered cell among those gone)
    const d = this.dims;
    if (d) {
      for (const p of (d.portals.get(d.dim) || []).slice()) if (seen.has(`${p[0]},${p[1]},${p[2]}`)) d.removePortal(d.dim, p[0], p[1], p[2]);
    }
    this._sound("break", x, y, z);
  }

  _dropVines(x, y, z) {
    const w = this.world;
    const list = [];
    for (let yy = y; yy > 0 && list.length < 4 * 64; yy--) {
      const id = w.getBlock(x, yy, z);
      if (!isWeepingVines(id)) break;
      list.push(x, yy, z, BLOCK.AIR);
      w.onBlockPopped?.(x, yy, z, id);
    }
    if (list.length) w.setBlocks(list);
  }

  // ---------- Coming out ----------

  // The engine's arrival (the ground round x, z is loaded): the registered
  // portal there if it still stands, else a new one. { x, y, z, yaw }.
  arrive(dim, x, y, z, found) {
    const w = this.world;
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    if (found) {
      let id = w.getBlock(bx, by, bz);
      if (isNetherPortal(id)) {
        let yy = by;
        while (yy > 1 && isNetherPortal(w.getBlock(bx, yy - 1, bz))) yy--;
        id = w.getBlock(bx, yy, bz);
        return this._standIn(bx, yy, bz, id - I.NETHER_PORTAL);
      }
      this.dims?.removePortal(dim, bx, by, bz);
    }
    // (an unregistered portal near: one made before, or by someone whose word was lost)
    const near = this._findPortalBlock(bx, by, bz, dim === NETHER ? 16 : 32);
    if (near) {
      this.dims?.addPortal(dim, near[0], near[1], near[2]);
      return this._standIn(near[0], near[1], near[2], w.getBlock(near[0], near[1], near[2]) - I.NETHER_PORTAL);
    }
    return this.buildPortal(dim, bx, by, bz);
  }

  // Standing in the portal cell (x, y, z), facing out of its plane (toward open ground).
  _standIn(x, y, z, axis) {
    const w = this.world;
    const [px, pz] = axis === 0 ? [0, 1] : [1, 0];
    const open = (s) => !IS_SOLID[w.getBlock(x + px * s, y, z + pz * s)] && !IS_SOLID[w.getBlock(x + px * s, y + 1, z + pz * s)];
    const s = open(1) || !open(-1) ? 1 : -1;
    // (yaw 0 looks toward -z: player.js's view)
    const yaw = Math.atan2(-px * s, -pz * s);
    return { x: x + 0.5, y, z: z + 0.5, yaw };
  }

  _findPortalBlock(x, y, z, r) {
    const w = this.world;
    let best = null;
    let bd = Infinity;
    const y0 = Math.max(1, y - 24);
    const y1 = Math.min(WORLD_HEIGHT - 2, y + 24);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (!w.getChunk((x + dx) >> 4, (z + dz) >> 4)) continue;
        for (let yy = y0; yy <= y1; yy++) {
          if (!isNetherPortal(w.getBlock(x + dx, yy, z + dz))) continue;
          if (isNetherPortal(w.getBlock(x + dx, yy - 1, z + dz))) continue;
          const d = dx * dx + dz * dz + (yy - y) * (yy - y);
          if (d < bd) {
            bd = d;
            best = [x + dx, yy, z + dz];
          }
        }
      }
    }
    return best;
  }

  // A new portal near (x, y, z) in the world's dimension: on the nearest
  // good spot within 16 blocks, else on a platform; registered. Its
  // standing spot, or null.
  buildPortal(dim, x, y, z) {
    const w = this.world;
    const info = w.dimInfo;
    const top = info.ceiling ? 118 : WORLD_HEIGHT - 6;
    const bottom = info.ceiling ? 33 : 2;
    // (each column's good floors: solid under, four open over)
    const good = new Map();
    const openAt = (id) => (id === BLOCK.AIR || (IS_REPLACEABLE[id] && !BLOCK_INFO[id]?.liquid && !isLava(id))) && id !== I.FIRE;
    const floors = (cx, cz) => {
      const k = `${cx},${cz}`;
      let set = good.get(k);
      if (set) return set;
      set = new Set();
      if (w.getChunk(cx >> 4, cz >> 4)) {
        let run = 0;
        for (let yy = top + 3; yy >= bottom; yy--) {
          const id = w.getBlock(cx, yy, cz);
          if (openAt(id)) run++;
          else {
            if (run >= 4 && IS_SOLID[id] && !isLava(id) && yy + 1 <= top) set.add(yy + 1);
            run = 0;
          }
        }
      }
      good.set(k, set);
      return set;
    };
    let best = null;
    let bd = Infinity;
    for (const deep of [true, false]) {
      for (let dx = -SEARCH_BUILD; dx <= SEARCH_BUILD; dx++) {
        for (let dz = -SEARCH_BUILD; dz <= SEARCH_BUILD; dz++) {
          const cx = x + dx;
          const cz = z + dz;
          for (const fy of floors(cx, cz)) {
            const d = dx * dx + dz * dz + (fy - y) * (fy - y);
            if (d >= bd) continue;
            for (const axis of [0, 1]) {
              const [ax, az] = AXIS[axis];
              const [px, pz] = AXIS[axis ^ 1];
              let ok = true;
              // (the frame's four columns along its plane, and one in front and behind when deep)
              for (let i = -1; i <= 2 && ok; i++) {
                for (let j = deep ? -1 : 0; j <= (deep ? 1 : 0) && ok; j++) {
                  if (!floors(cx + ax * i + px * j, cz + az * i + pz * j).has(fy)) ok = false;
                }
              }
              if (ok) {
                bd = d;
                best = { x: cx, y: fy, z: cz, axis };
                break;
              }
            }
          }
        }
      }
      if (best) break;
    }
    let forced = false;
    if (!best) {
      // (vanilla: at the spot, its height kept between 70 and the top less
      // 10, on obsidian. This Overworld's sea is at 24, not 63, its ground
      // far under 70: there it stands on the ground's top, or just over the
      // sea, not floating 46 blocks up)
      forced = true;
      const fy = info.ceiling ? Math.max(70, y) : Math.max(SEA_LEVEL + 1, w.surfaceY(x, z) + 1);
      best = { x, y: Math.min(info.ceiling ? 110 : WORLD_HEIGHT - 10, fy), z, axis: 0 };
    }
    const { axis } = best;
    const [ax, az] = AXIS[axis];
    const [px, pz] = AXIS[axis ^ 1];
    const list = [];
    if (forced) {
      for (let i = 0; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (let k = -1; k <= 2; k++) list.push(best.x + ax * i + px * j, best.y + k, best.z + az * i + pz * j, k < 0 ? I.OBSIDIAN : BLOCK.AIR);
        }
      }
    }
    for (let i = -1; i <= 2; i++) {
      for (let h = -1; h <= 3; h++) {
        const frame = i === -1 || i === 2 || h === -1 || h === 3;
        list.push(best.x + ax * i, best.y + h, best.z + az * i, frame ? I.OBSIDIAN : I.NETHER_PORTAL + axis);
      }
    }
    w.setBlocks(list);
    this.dims?.addPortal(dim, best.x, best.y, best.z);
    this.stats.built++;
    return this._standIn(best.x, best.y, best.z, axis);
  }

  // ---------- The respawn anchor ----------

  // A charged anchor used: the spawn in the Nether; an explosion anywhere else.
  useAnchor(ctx) {
    const { x, y, z } = ctx;
    const d = this.dims;
    if (!d || d.dim !== NETHER) {
      d?._bedBlast?.({ bed: { head: [x, y, z] }, x, y, z });
      return true;
    }
    const sleep = this.game.sleep;
    if (!sleep) return false;
    const same = sleep.spawn && sleep.spawnDim === NETHER && sleep.spawn[0] === x && sleep.spawn[1] === y && sleep.spawn[2] === z;
    sleep.spawn = [x, y, z];
    sleep.spawnDim = NETHER;
    sleep.d?.onSpawnSet?.();
    this.game.toast?.(same ? "Respawn point already set here" : "Respawn point set", 2);
    this._sound("anchor", x, y, z);
    return true;
  }

  // (The respawn after a death and the End's exit: an anchor's spawn is in the Nether.)
  _hookSpawn() {
    const d = this.dims;
    const g = this.game;
    d.respawnDimension = () => (g.sleep?.spawn && g.sleep.spawnDim === NETHER ? NETHER : OVERWORLD);
    const sleep = g.sleep;
    if (sleep && typeof sleep.respawnSpot === "function") {
      const bedSpot = sleep.respawnSpot.bind(sleep);
      sleep.respawnSpot = () => (sleep.spawn && sleep.spawnDim === NETHER ? this._anchorSpot() : bedSpot());
    }
    const toSpawn = d.toSpawn.bind(d);
    d.toSpawn = () => {
      if (!(sleep?.spawn && sleep.spawnDim === NETHER)) return toSpawn();
      const [x, y, z] = sleep.spawn;
      // (the anchor gone or empty, its ground not loaded from here: the spawn
      // forgotten, the bed's way instead, as at a respawn)
      if (!(anchorCharge(this.world.blockIn(NETHER, x, y, z)) > 0)) {
        sleep.spawn = null;
        sleep.spawnDim = OVERWORLD;
        this.game.toast?.("Your home bed was missing or obstructed", 4);
        return toSpawn();
      }
      return d.travel(NETHER, x + 0.5, y + 1, z + 0.5, { place: "safe" });
    };
  }

  // The spot by the anchor, a charge used; false (it is gone or empty: the
  // spawn forgotten, the world back in the Overworld for the world spawn).
  _anchorSpot() {
    const sleep = this.game.sleep;
    const w = this.world;
    const [x, y, z] = sleep.spawn;
    const id = w.dim === NETHER ? w.getBlock(x, y, z) : -1;
    const c = anchorCharge(id);
    let spot = null;
    if (c > 0) {
      // (vanilla: the cells round it first, then on top)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 0]]) {
        for (const dy of dx || dz ? [0, -1, 1] : [1]) {
          const sx = x + dx;
          const sy = y + dy;
          const sz = z + dz;
          if (IS_SOLID[w.getBlock(sx, sy, sz)] || IS_SOLID[w.getBlock(sx, sy + 1, sz)] || !IS_SOLID[w.getBlock(sx, sy - 1, sz)] || isLava(w.getBlock(sx, sy - 1, sz))) continue;
          spot = { x: sx + 0.5, y: sy, z: sz + 0.5 };
          break;
        }
        if (spot) break;
      }
    }
    if (!spot) {
      sleep.spawn = null;
      sleep.spawnDim = OVERWORLD;
      if (this.dims.dim !== OVERWORLD) this.dims.enterNow(OVERWORLD);
      return false;
    }
    if (!this.game.player.creative) w.setBlock(x, y, z, I.RESPAWN_ANCHOR + c - 1);
    return spot;
  }

  // ---------- Per frame ----------

  update(dt) {
    this._flush();
    const d = this.dims;
    if (!d?.enabled) return;
    const p = this.player;
    // (the trigger sound when the wait starts, the travel's as it ends)
    const k = d.portalProgress;
    if (k > 0.02 && this._waiting <= 0.02) this._sound("trigger");
    if (this._waiting > 0.9 && d.pending) this._sound("travel");
    this._waiting = d.pending ? 0 : k;
    if (k > 0) this._swirl();
    // Portals near: motes and the hum.
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = 1;
      this._scanNear();
    }
    if (!this._near.length || d.pending) return;
    this._moteT += dt;
    const glow = this.game.effects?.glow;
    while (this._moteT > 0.05 && glow) {
      this._moteT -= 0.05;
      const c = this._near[Math.floor(Math.random() * this._near.length)];
      glow.spawn({ x: c[0] + Math.random(), y: c[1] + Math.random(), z: c[2] + Math.random(), vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.3) * 0.8, vz: (Math.random() - 0.5) * 0.6, life: 1.2, size0: 0.09, size1: 0.02, color0: MOTE, color1: MOTE_END, drag: 0.6 });
    }
    this._ambT -= dt;
    if (this._ambT <= 0) {
      this._ambT = 4 + Math.random() * 6;
      const c = this._near[0];
      this._sound("ambient", c[0], c[1], c[2], Math.hypot(c[0] + 0.5 - p.position.x, c[1] - p.position.y, c[2] + 0.5 - p.position.z));
    }
  }

  // The portal cells within 8 blocks (a few: the nearest first).
  _scanNear() {
    const w = this.world;
    const p = this.player.position;
    const x0 = Math.floor(p.x);
    const y0 = Math.floor(p.y);
    const z0 = Math.floor(p.z);
    const out = [];
    for (let dx = -8; dx <= 8; dx++) {
      for (let dz = -8; dz <= 8; dz++) {
        for (let dy = -4; dy <= 5; dy++) {
          if (isNetherPortal(w.getBlock(x0 + dx, y0 + dy, z0 + dz))) out.push([x0 + dx, y0 + dy, z0 + dz, dx * dx + dy * dy + dz * dz]);
        }
      }
    }
    out.sort((a, b) => a[3] - b[3]);
    this._near = out.slice(0, 24);
  }

  // The engine's overlay while waiting in a portal, turning (a CSS swirl: no cost to the frame).
  _swirl() {
    if (this._styled || typeof document === "undefined") return;
    const el = document.getElementById("dim-portal");
    if (!el) return;
    this._styled = true;
    const st = document.createElement("style");
    st.textContent = `#dim-portal{overflow:hidden}#dim-portal::before{content:"";position:absolute;inset:-50%;background:repeating-conic-gradient(from 0deg,rgba(170,80,255,0.22) 0deg 10deg,rgba(60,0,120,0) 10deg 24deg);animation:dimPortalSwirl 7s linear infinite}#dim-portal::after{content:"";position:absolute;inset:0;background:radial-gradient(circle,rgba(0,0,0,0) 30%,rgba(70,0,140,0.55));animation:dimPortalPulse 1.6s ease-in-out infinite alternate}@keyframes dimPortalSwirl{to{transform:rotate(360deg) scale(1.15)}}@keyframes dimPortalPulse{from{opacity:.55}to{opacity:1}}`;
    document.head.appendChild(st);
  }

  // The portal's sounds, made of noise (audio.js's own pieces).
  _sound(kind, x, y, z, dist = 0) {
    const a = this.game.audio;
    if (!a?.ctx || typeof a._hit !== "function") return;
    const play = () => {
      a._cat("blocks");
      if (kind === "ambient") a._hit({ type: "bandpass", f: 260, q: 3, d: 2.4, v: 0.12, attack: 0.9, fEnd: 520 });
      else if (kind === "trigger") {
        a._hit({ type: "bandpass", f: 180, q: 2, d: 3.5, v: 0.22, attack: 1.4, fEnd: 900 });
        a._tone?.(110, 3.5, { type: "sawtooth", vol: 0.035, fEnd: 330, attack: 1.2 });
      } else if (kind === "travel") {
        a._hit({ type: "lowpass", f: 900, q: 1, d: 1.6, v: 0.3, attack: 0.05, fEnd: 120 });
        a._tone?.(600, 1.2, { type: "sine", vol: 0.06, fEnd: 90 });
      } else if (kind === "light") a._hit({ type: "bandpass", f: 500, q: 1.5, d: 1.1, v: 0.3, attack: 0.02, fEnd: 1400 });
      else if (kind === "break") a._hit({ type: "highpass", f: 1800, q: 1, d: 0.5, v: 0.25, attack: 0.005 });
      else if (kind === "anchor") {
        a._hit({ type: "bandpass", f: 300, q: 4, d: 0.8, v: 0.28, attack: 0.01, fEnd: 120 });
        a._tone?.(220, 0.7, { type: "sine", vol: 0.08, fEnd: 440 });
      }
    };
    if (x === undefined) return play();
    const p = this.player.position;
    a.playDistant?.(dist || Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y, z + 0.5 - p.z), play);
  }
}

const SIX = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
// (as js/content/nether.js's weeping vines' support)
function weepingHolds(above) {
  return (IS_SOLID[above] === 1 && IS_OPAQUE[above] === 1) || isWeepingVines(above) || above === I.NETHER_WART_BLOCK || above === I.WARPED_WART_BLOCK;
}

