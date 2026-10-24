// The dimensions (Round 12): the Overworld, the Nether and the End, and the
// travel between them, alone and online. The rules of each dimension and
// their terrain generators are js/dim-registry.js; this is the engine the
// Nether's and the End's parts build on (their terrain, blocks, portals,
// structures and creatures).
//
// One world, one dimension at a time (as a vanilla player is in one): the
// World (world.js) holds the chunks, the generator and the edits of the
// dimension it is in, and every other dimension's edits aside. A change of
// dimension (travel, enterNow):
//   - the systems that hold positions of their own hand this dimension's
//     state over and take the next one's: flowing water's cells, lava's and
//     fire's woken cells (watersim.js, lavasim.js, nature-sim.js), the
//     creatures players keep (bred, tame, villagers: mobs.js serializeKept,
//     re-spawned there as their ground loads), the XP orbs lying there
//     (xp.js stash: back as they were on the return); falling blocks land
//     first; primed TNT, thrown things and spawner caches are let go;
//   - the containers (chests, furnaces, brewing stands) and signs are not
//     swapped: every dimension's are in one store, keyed by dimension
//     ("n:x,y,z", dim-registry.js dimKey), so the host can serve them all;
//     dropped items carry their dimension (only this one's are drawn, move
//     and can be picked up: js/entities.js);
//   - the world drops every chunk (meshes freed; the workers' chunks for the
//     old dimension are dropped when they come back) and streams the new
//     one in around the arrival; a loading screen holds the player until
//     the ground there is in (or 10 s, then it is made at once);
//   - the sky, fog and light become that dimension's (sky.js setDimension;
//     its light floor: main.js's night-vision line), the weather is the
//     Overworld's only (weather.js), the distant tiles are the Overworld's
//     only (the view is capped there instead, the LOD planning made all
//     full chunks: _wrapLod), the distant villages hide.
// (Round 13) A Missions world has them too; its Missions layer (UFOs,
// missions, supply drops, the aircraft) stays in the Overworld: main.js
// pauses it while this player is elsewhere (onChange), and the messages
// about it from a peer in another dimension are dropped (DIM_DROP).
//
// Saves: each dimension's edits under a key of its own (storage.js,
// saveEdits below), and in the player's save `dim` (where the player is;
// none: the Overworld) and `dims` ({ nether, end: { water, mobs, seeded },
// portals }); the save's `water` and `mobs` stay the Overworld's (overworld()
// below), so a save from before is an Overworld save as it was.
//
// ONLINE. Each player is in one dimension (js/net/session.js dimCode; the
// host's player list has everyone's, setPlayerDim). The rules:
//   - Block edits: every batch says its dimension ("dm"); a peer there applies
//     it, any other records it among that dimension's edits; the host relays
//     every batch to everyone and keeps and saves all of them; a joining
//     player gets every dimension's (js/net/world.js). So a guest coming back
//     sees whatever the others changed meanwhile.
//   - Chests, furnaces, brewing stands, signs: the host owns every
//     dimension's (their messages carry "dm"); it smelts and brews in its
//     own loaded ground and near each guest in that guest's dimension.
//   - Dropped items: shared as before, each with its dimension; picking one
//     up is still asked of the host, whatever dimension it is in.
//   - What happens somewhere (explosions, shots, projectiles, thrown
//     bottles, lightning, primed TNT, the host's creatures' states) is
//     stamped with its dimension and dropped by a peer elsewhere
//     (session.js dimDrop). Player states carry it too: a player in another
//     dimension is not drawn, has no nameplate, is no creature's target and
//     is in no "players here" list (net/players.js `seen`); the lobby's
//     player list shows where each one is.
//   - Simulation authority, per dimension: the host simulates its own
//     dimension, as before (creatures, fire, redstone, random ticks,
//     weather). For a dimension the host is not in, the guest with the
//     lowest player number there simulates its world (fire, redstone,
//     random ticks: simulatesWorld()), and its results are ordinary edits
//     that go through the host, which stores and relays them; the role moves
//     as soon as that guest leaves the dimension or the host comes in.
//     Creatures in a dimension the host is not in are each guest's own this
//     round (DimSync._creatures: not shared between two guests there; their
//     drops are shared items), and come back to the host's on returning to
//     the host's dimension. Water and lava flow for whoever made the edit,
//     as before. The weather's cycle stays the host's (the Overworld's).
//   - A late joiner arrives in the dimension the host kept for them (their
//     things, js/net/coop.js), else in the Overworld, with every
//     dimension's edits.
// Older peers are refused at the handshake (NET_VERSION).
//
// PORTALS (the Nether's and the End's parts): a block in PORTAL_BLOCKS
// (dim-registry.js: id -> kind "nether" | "end" | "end_exit") where the
// player's feet or head are puts them in that portal, as does
// enterPortal(kind, at) called every frame (at: the block). A nether portal takes 4 s (vanilla's 80
// ticks; at once in Creative), and carries the position over at 1:8; the
// End's portal is at once, to the obsidian platform at 100, 49, 0 (rebuilt
// on every arrival, as vanilla); the End's exit to the player's spawn (the
// bed, else the world spawn). After any arrival the player must step out of
// the portal before it works again. Where a nether portal leads: the
// registered portal nearest the scaled spot (within 128 blocks in the
// Overworld, 16 in the Nether: addPortal / nearestPortal, saved and shared
// online), else portalLinks.nether.arrive builds one (the Nether part), else
// a safe spot near, else a small obsidian platform. Hooks for those parts:
//   dims.portalLinks[kind] = { find(dim, x, y, z, radius, dims), arrive(dim, x, y, z, found, dims) }
//   dims.onChange.push((dim, from) => ...)      after every change of dimension
//   dims.respawnDimension = () => "overworld"   where a dead player comes back
//   DIMS.nether.spawnMobs = (mobs, dt) => ...   its creatures (mobs.js)
// Testing: F7 in Creative goes Overworld -> Nether -> End -> Overworld; the
// page's debug object has `dims` (travel, enterPortal, ...).
import * as THREE from "three";
import { DIMS, OVERWORLD, NETHER, END, DIM_IDS, PORTAL_BLOCKS, dimId, codeOf, scaleBetween } from "./dim-registry.js";
import { loadEdits, saveEdits as storeEdits } from "./storage.js";
import { WaterSim } from "./watersim.js";
import { BLOCK, IS_SOLID, IS_WET } from "./blocks.js";
import { OBSIDIAN, FIRE } from "./content/ids.js";
import { isLava } from "./content/nature.js";
import { LIB } from "./content/base.js";
import { HOST_PID } from "./net/session.js";
import { WORLD_HEIGHT } from "./constants.js";
import { vanillaRules } from "./worldtype.js";

export { DIMS, PORTAL_BLOCKS };

export const PORTAL_TIME = 4; // seconds in a nether portal (vanilla: 80 ticks)
export const PORTAL_SEARCH = { [OVERWORLD]: 128, [NETHER]: 16, [END]: 0 }; // (vanilla's, at the destination)
export const END_PLATFORM = { x: 100, y: 48, z: 0 }; // (vanilla: the obsidian platform's middle block)
const LOAD_TIMEOUT = 10; // seconds (real ones: a slow computer's frames are clamped) before the arrival ground is made at once
const WATER_CAP = 12000; // flow cells saved per dimension (a Survival world's, as main.js)
const MAX_PORTALS = 512; // registered per dimension
const BED_RADIUS = (5 * 4) / 3; // (effects.js units: vanilla's power 5, TNT's 4 being 16/3)
// What happens somewhere: dropped by a peer in another dimension (js/net/session.js).
const DIM_DROP = ["fx", "pj", "eadd", "es", "erem", "rs", "bolt", "pth", "psp", "alarm", "dashw", "abd"];
const SMOKE = { r: 0.75, g: 0.75, b: 0.78 };

// The dimension a save was made in (the Overworld for an older save, a
// guest's page). (Round 13: a Missions world's too: the dimensions are in
// both world types; its Missions layer stays in the Overworld, main.js.)
export function savedDimension(saved) {
  return vanillaRules() ? dimId(saved?.dim) : OVERWORLD;
}

// The other dimensions' saved edits into the world (main.js, at startup,
// after the Overworld's).
export function loadDimensionEdits(world, seed) {
  if (!vanillaRules()) return;
  for (const dim of DIM_IDS) {
    if (dim === OVERWORLD) continue;
    const edits = loadEdits(seed, dim);
    if (edits.size) world.loadEdits(edits, dim);
  }
}

export class DimensionManager {
  // game: main.js's game object (world, player, sky, mobs, entities, ...);
  // extra: what it lacks ({ lod, distant, signs, brewing, potionThrows,
  // spawners, weather, invScreen, streamAround, mp }).
  constructor(game, extra = {}) {
    this.game = game;
    this.x = extra;
    this.world = game.world;
    this.player = game.player;
    this.mp = extra.mp || null;
    this.world.dims = this;
    this.enabled = vanillaRules(); // (Round 13: a Missions world's too)
    this.stash = new Map(); // dim -> the state of a dimension the world is not in
    this.portals = new Map(); // dim -> [[x, y, z], ...] (registered portal blocks)
    this.portalLinks = {}; // kind -> { find, arrive } (the Nether's and the End's parts)
    this.onChange = []; // fns (dim, from) after every change of dimension
    this.respawnDimension = () => OVERWORLD;
    this.pending = null; // a travel waiting for its ground
    this._portal = null; // the portal stood in this frame: { kind, at }
    this._portalT = 0;
    this._needExit = false;
    this._cool = 0;
    this._caches = new Map(); // dim -> the edits' encoded form between saves (the Overworld's is main.js's)
    this._loadEl = null;
    this._portalEl = null;
    this.stats = { switches: 0, lastSwitchMs: 0 };
    if (!this.enabled) return;
    this._wrapLod();
    this._hookBeds();
    this.world.onEvaporate = (list) => this._evaporated(list);
    this.sync = this.mp ? new DimSync(this.mp, this) : null;
    if (typeof window !== "undefined") window.addEventListener("keydown", (e) => this._key(e));
  }

  get dim() {
    return this.world.dim;
  }

  get info() {
    return this.world.dimInfo;
  }

  get code() {
    return this.world.dimCode;
  }

  // The darkest light here (vanilla's ambient light: main.js's light floor).
  get lightFloor() {
    return this.info.lightFloor || 0;
  }

  // ---------- Travel ----------

  // Takes this player to (x, y, z) in `dim`: the world goes there at once,
  // and the player is held under a loading screen until the ground is in,
  // then put on a safe spot near (opts.place: "safe" (default), "exact",
  // "portal" (opts.kind, opts.found), "endPlatform", "spawn"); opts.yaw: the
  // way they face. False if refused (already travelling, in a vehicle).
  travel(dim, x, y, z, opts = {}) {
    dim = dimId(dim);
    if (!this.enabled || this.pending || this.player.vehicle) return false;
    if (![x, y, z].every(Number.isFinite)) return false;
    const p = this.player;
    if (dim !== this.dim) this._switch(dim);
    this.pending = { dim, x, y, z, opts, t0: performance.now(), wasEnabled: p.enabled };
    p.enabled = false;
    this._hold();
    this._showLoading(dim);
    return true;
  }

  // The world goes to `dim` now, without a loading screen (respawning,
  // joining, a save made there: the caller prepares the ground). False if
  // already there.
  enterNow(dim) {
    dim = dimId(dim);
    if (dim === this.dim) return false;
    if (!this.enabled) return false;
    this._cancelPending();
    this._switch(dim);
    this._portalT = 0;
    return true;
  }

  // Called every frame the player stands in a portal block (the portal
  // parts' code): kind "nether" | "end" | "end_exit", at: the block ({ x, y, z }).
  enterPortal(kind, at = null) {
    if (!this.enabled || this.player.dead) return;
    this._portal = { kind, at: at || this.player.position };
  }

  // The portal block the player's feet or head are in, if any.
  _portalHere() {
    const p = this.player.position;
    const w = this.world;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    for (const dy of [0.1, 1.2]) {
      const y = Math.floor(p.y + dy);
      const kind = PORTAL_BLOCKS.get(w.getBlock(x, y, z));
      if (kind) {
        this._portal = { kind, at: { x, y, z } };
        return;
      }
    }
  }

  // 0-1: how far through a nether portal's wait this player is (an overlay).
  get portalProgress() {
    return Math.min(1, this._portalT / PORTAL_TIME);
  }

  // Per frame (main.js): portals, and a travel waiting for its ground.
  update(dt) {
    if (!this.enabled) return;
    // (Held: paused alone, dead, waiting for ground. The wait, the cool-down
    // and the step out of the arrival portal stay as they are meanwhile.)
    const live = this.player.enabled && !this.player.dead;
    if (live) this._cool = Math.max(0, this._cool - dt);
    if (!this._portal && PORTAL_BLOCKS.size && !this.pending && live) this._portalHere();
    const pt = this._portal;
    this._portal = null;
    if (pt && !this.pending && live) {
      if (!this._needExit && this._cool <= 0) {
        if (pt.kind === "nether") {
          this._portalT += dt;
          if (this.player.creative || this._portalT >= PORTAL_TIME) this._throughPortal(pt);
        } else this._throughPortal(pt);
      }
    } else if (!pt && live && !this.pending) {
      // (out of the portal: the wait drains, and the next one counts again)
      this._portalT = Math.max(0, this._portalT - dt * 4);
      this._needExit = false;
    }
    this._showPortal(pt && pt.kind === "nether" && !this._needExit ? this.portalProgress : 0);
    if (this.pending) this._loadStep();
  }

  _throughPortal(pt) {
    const at = pt.at;
    this._portalT = 0;
    if (pt.kind === "end") {
      this.travel(END, END_PLATFORM.x + 0.5, END_PLATFORM.y + 1, END_PLATFORM.z + 0.5, { place: "endPlatform", yaw: Math.PI / 2, from: this._from(at) });
    } else if (pt.kind === "end_exit") {
      this.toSpawn();
    } else if (pt.kind === "nether") {
      if (this.dim === END) return;
      const to = this.dim === NETHER ? OVERWORLD : NETHER;
      const x = scaleBetween(this.dim, to, Math.floor(at.x) + 0.5);
      const z = scaleBetween(this.dim, to, Math.floor(at.z) + 0.5);
      const y = Math.max(1, Math.min(to === NETHER ? 120 : WORLD_HEIGHT - 3, Math.floor(at.y)));
      const link = this.portalLinks.nether || {};
      const r = PORTAL_SEARCH[to];
      const found = (link.find ? link.find(to, x, y, z, r, this) : this.nearestPortal(to, x, y, z, r)) || null;
      const dest = found ? { x: found[0] ?? found.x, y: found[1] ?? found.y, z: found[2] ?? found.z } : { x, y, z };
      this.travel(to, dest.x + (found ? 0.5 : 0), dest.y, dest.z + (found ? 0.5 : 0), { place: "portal", kind: "nether", found: !!found, from: this._from(at) });
    }
  }

  // (Where a trip through a portal started: the portal's cell, the player's
  // height. A save made before the arrival puts them back there.)
  _from(at) {
    return { dim: this.dim, x: Math.floor(at.x), y: this.player.position.y, z: Math.floor(at.z) };
  }

  // To the player's spawn in the Overworld (the End's exit portal): the bed
  // if it is still there, else the world spawn.
  toSpawn() {
    const bed = this.game.sleep?.spawn;
    const s = this.game.spawn || { x: 0, z: 0 };
    const [x, y, z] = bed ? [bed[0] + 0.5, bed[1] + 1, bed[2] + 0.5] : [s.x + 0.5, 70, s.z + 0.5];
    return this.travel(OVERWORLD, x, y, z, { place: "spawn" });
  }

  // (The player held where the travel puts them while the ground comes in.)
  _hold() {
    const pd = this.pending;
    const p = this.player;
    p.position.set(pd.x, pd.y, pd.z);
    p.velocity.set(0, 0, 0);
    p.syncCamera?.();
    this.x.streamAround?.(pd.x, pd.z);
  }

  _loadStep() {
    const pd = this.pending;
    this._hold();
    const w = this.world;
    const cx = Math.floor(pd.x) >> 4;
    const cz = Math.floor(pd.z) >> 4;
    let ready = !!w.getChunk(cx, cz)?.meshed;
    for (let dz = -1; dz <= 1 && ready; dz++) for (let dx = -1; dx <= 1 && ready; dx++) if (!w.getChunk(cx + dx, cz + dz)) ready = false;
    if (!ready && performance.now() - pd.t0 < LOAD_TIMEOUT * 1000) return;
    if (!ready) w.prepareArea(pd.x, pd.z, 1);
    this._arrive(pd);
  }

  _arrive(pd) {
    const o = pd.opts;
    let spot = null;
    if (o.place === "portal") spot = this.portalLinks[o.kind]?.arrive?.(pd.dim, pd.x, pd.y, pd.z, !!o.found, this) || null;
    else if (o.place === "endPlatform") spot = this.buildEndPlatform();
    else if (o.place === "exact") spot = { x: pd.x, y: pd.y, z: pd.z };
    else if (o.place === "spawn") spot = this._spawnSpot(pd);
    if (!spot) spot = this.safeSpot(pd.x, pd.y, pd.z) || this.buildPlatform(pd.x, pd.y, pd.z);
    this.pending = null;
    const p = this.player;
    p.position.set(spot.x, spot.y, spot.z);
    p.velocity.set(0, 0, 0);
    p.knockback?.set(0, 0, 0);
    p.resetFall?.();
    const yaw = Number.isFinite(spot.yaw) ? spot.yaw : o.yaw;
    if (Number.isFinite(yaw)) p.yaw = yaw;
    p.enabled = pd.wasEnabled;
    p.syncCamera?.();
    this.x.streamAround?.(spot.x, spot.z);
    this._hideLoading();
    this._needExit = true;
    this._cool = 1;
    this._portalT = 0;
    if (o.place === "portal" || o.place === "endPlatform") this.game.audio?.playTeleport?.();
  }

  _spawnSpot(pd) {
    const bed = this.game.sleep?.spawn ? this.game.sleep.respawnSpot?.() : null;
    if (bed) return { x: bed.x, y: bed.y, z: bed.z };
    let { x, z } = pd;
    if (bed === false) {
      // (The bed gone or obstructed (respawnSpot forgot it): the world spawn, as a respawn.)
      const s = this.game.spawn || { x: 0, z: 0 };
      x = s.x + 0.5;
      z = s.z + 0.5;
      this.world.prepareArea(x, z, 1);
      this.game.toast?.("Your home bed was missing or obstructed", 4);
    }
    const top = this.world.surfaceY(Math.floor(x), Math.floor(z));
    return top >= 0 ? this.safeSpot(x, top + 1, z) : null;
  }

  _cancelPending() {
    const pd = this.pending;
    if (!pd) return;
    this.pending = null;
    this.player.enabled = pd.wasEnabled;
    this._hideLoading();
  }

  // ---------- Where to stand ----------

  _open(id) {
    return !IS_SOLID[id] && !IS_WET[id] && !isLava(id) && id !== FIRE;
  }

  // A spot to stand on near (x, y, z) in the loaded ground: two open cells
  // over a solid block that is neither lava nor fire, the nearest to y in
  // the nearest column (within `r` blocks across, 24 up or down), or null.
  safeSpot(x, y, z, r = 12) {
    const w = this.world;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const by = Math.floor(y);
    const top = this.info.ceiling ? WORLD_HEIGHT - 6 : WORLD_HEIGHT - 2;
    for (let ring = 0; ring <= r; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const cx = bx + dx;
          const cz = bz + dz;
          if (!w.getChunk(cx >> 4, cz >> 4)) continue;
          for (let k = 0; k <= 48; k++) {
            const yy = by + (k & 1 ? -((k + 1) >> 1) : k >> 1);
            if (yy < 1 || yy > top) continue;
            const below = w.getBlock(cx, yy - 1, cz);
            if (!IS_SOLID[below] || isLava(below) || below === FIRE) continue;
            if (this._open(w.getBlock(cx, yy, cz)) && this._open(w.getBlock(cx, yy + 1, cz))) return { x: cx + 0.5, y: yy, z: cz + 0.5 };
          }
        }
      }
    }
    return null;
  }

  // No spot near: a 3 x 3 obsidian floor at (x, y, z) with room above it
  // (vanilla makes one for a portal it can't place), above the Nether's
  // lava sea. An edit, so everyone online has it.
  buildPlatform(x, y, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const by = Math.max(this.info.ceiling ? 34 : 8, Math.min(this.info.ceiling ? WORLD_HEIGHT - 10 : WORLD_HEIGHT - 4, Math.floor(y)));
    const list = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        list.push(bx + dx, by - 1, bz + dz, OBSIDIAN);
        for (let h = 0; h < 3; h++) list.push(bx + dx, by + h, bz + dz, BLOCK.AIR);
      }
    }
    this.world.setBlocks(list);
    return { x: bx + 0.5, y: by, z: bz + 0.5 };
  }

  // The End's arrival (vanilla's, on every arrival): a 5 x 5 obsidian floor
  // at y 48 around (100, 0), three blocks of air over it.
  buildEndPlatform() {
    const { x, y, z } = END_PLATFORM;
    const list = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        list.push(x + dx, y, z + dz, OBSIDIAN);
        for (let h = 1; h <= 3; h++) list.push(x + dx, y + h, z + dz, BLOCK.AIR);
      }
    }
    this.world.setBlocks(list);
    return { x: x + 0.5, y: y + 1, z: z + 0.5, yaw: Math.PI / 2 };
  }

  // ---------- The switch ----------

  _fresh() {
    return { water: null, waterList: undefined, waterSaved: undefined, lava: null, fire: null, mobs: [], seeded: false, xp: null };
  }

  _stashOf(dim) {
    let s = this.stash.get(dim);
    if (!s) this.stash.set(dim, (s = this._fresh()));
    return s;
  }

  // A stashed dimension's water state, made from its saved list if need be.
  _waterState(s) {
    if (s.water) return s.water;
    if (s.waterList) {
      s.water = { meta: WaterSim.metaFromList(s.waterList), active: new Set() };
      s.waterList = undefined;
    }
    return s.water;
  }

  // What the creatures players keep are now (kept ones not spawned yet too).
  _keptNow() {
    const mobs = this.game.mobs;
    const out = [];
    const live = mobs?.serializeKept?.();
    if (Array.isArray(live)) out.push(...live);
    if (Array.isArray(mobs?._kept)) out.push(...mobs._kept);
    return out.slice(0, 400);
  }

  _switch(dim) {
    const t0 = performance.now();
    const g = this.game;
    const x = this.x;
    const from = this.world.dim;
    const next = this.stash.get(dim) || this._fresh();
    this.stash.delete(dim);
    // (What this dimension still owes: our edits go out, the falling blocks land.)
    this.sync?.beforeSwitch();
    g.falling?.landAll?.();
    g.interaction?.release?.();
    if (x.invScreen?.isOpen) x.invScreen.onCloseRequest?.();
    if (x.signs?.isEditing) x.signs.close(true, true);
    const prev = this._fresh();
    prev.water = g.waterSim?.swapDim?.(this._waterState(next)) || null;
    prev.lava = g.natureSim?.lava?.swapDim?.(next.lava) || null;
    prev.fire = g.natureSim?.fire?.swapDim?.(next.fire) || null;
    const mobs = g.mobs;
    if (mobs) {
      prev.mobs = this._keptNow();
      prev.seeded = !!mobs._seeded;
      mobs.clear();
      for (const list of [mobs.arrows, mobs.potions]) {
        if (!Array.isArray(list)) continue;
        for (const a of list) if (a.mesh) mobs.group?.remove(a.mesh);
        list.length = 0;
      }
      mobs._kept = [];
    }
    g.redstone?.clear?.();
    // (The orbs lying here wait for the player's return, as the kept creatures: a death's too.)
    prev.xp = g.xp?.stash ? g.xp.stash() : (g.xp?.clear?.(), null);
    g.weapons?.throwables?.clear?.();
    x.potionThrows?.clear?.();
    const sp = x.spawners;
    if (sp) {
      sp._found?.clear?.();
      sp.state?.clear?.();
      if (Array.isArray(sp.active)) sp.active.length = 0;
    }
    this.stash.set(from, prev);
    // (The last moment's Overworld edits to the distant tiles' builders: _resetLod forgets the rest.)
    if (from === OVERWORLD) this._lodFlush?.(true);
    this.world.setDimension(dim);
    // The new one's.
    if (mobs) {
      mobs.loadKept?.(next.mobs || []);
      mobs._seeded = !!next.seeded;
    }
    g.xp?.unstash?.(next.xp);
    x.weather?.dimChanged?.();
    g.sky?.setDimension?.(this.info);
    if (x.distant) x.distant.enabled = this.info.lod !== false;
    this._resetLod();
    this._portalT = 0;
    this.stats.switches++;
    this.stats.lastSwitchMs = performance.now() - t0;
    this.sync?.changed();
    for (const fn of this.onChange) {
      try {
        fn(dim, from);
      } catch (err) {
        console.error("MINECLAUDE: a dimension listener failed", err);
      }
    }
  }

  // ---------- Distant terrain ----------

  // The distant tiles are the Overworld's height map: elsewhere every chunk
  // in sight is a full one, out to the dimension's capped view (lod.js
  // plans them all as detail chunks). The game's own render and detail
  // distances are remembered and come back in the Overworld.
  _wrapLod() {
    const lod = this.x.lod;
    if (!lod || typeof lod.configure !== "function") return;
    const want = (this._lodWant = { renderDistance: lod.renderDistance, detailDistance: lod.detailDistance });
    const configure = lod.configure.bind(lod);
    lod.configure = (o = {}) => {
      if (o.renderDistance !== undefined) want.renderDistance = o.renderDistance;
      if (o.detailDistance !== undefined) want.detailDistance = o.detailDistance;
      configure({ ...o, ...this._lodView() });
    };
    // (Nothing to send its builders from another dimension's edits.)
    const flush = typeof lod._flushEdits === "function" ? lod._flushEdits.bind(lod) : null;
    this._lodFlush = flush;
    if (flush) {
      lod._flushEdits = (force) => {
        if (this.info.lod === false) {
          lod._editedChunks?.clear?.();
          return;
        }
        return flush(force);
      };
    }
  }

  // (Every chunk drawn in full there, as the detail chunks here: as far as
  // the graphics' own detail distance, at least the dimension's minView, at
  // most its maxView; the sky's fog ends with it.)
  _lodView() {
    const want = this._lodWant;
    const info = this.info;
    if (info.lod !== false) return { renderDistance: want.renderDistance, detailDistance: want.detailDistance };
    const rd = Math.min(want.renderDistance, info.maxView, Math.max(want.detailDistance, info.minView || 4));
    if (this.game.sky) this.game.sky.dimView = rd;
    return { renderDistance: rd, detailDistance: rd + 1 };
  }

  // Every tile goes (they showed the other dimension), the plan starts over.
  _resetLod() {
    const lod = this.x.lod;
    if (!lod) return;
    if (lod.tiles) for (const tile of [...lod.tiles.values()]) lod._disposeTile?.(tile);
    if (Array.isArray(lod._results)) lod._results.length = 0;
    lod._inFlight?.clear?.();
    lod._queue = [];
    lod._leafKeys = new Set();
    lod._split = new Set();
    lod._detail = new Set();
    lod.roots = [];
    lod._shownChunks = new Set();
    lod._shownTiles = new Set();
    lod._editedChunks?.clear?.();
    lod._dirty = true;
    lod._replan = true;
    lod._pcx = lod._pcz = null;
    if (this._lodWant) lod.configure({});
  }

  // ---------- The Nether's rules ----------

  // A bed used where beds explode: the bed goes in a blast of power 5 that
  // sets fires (vanilla's "intentional game design").
  _hookBeds() {
    const use = LIB.onBedUse;
    LIB.onBedUse = (ctx) => (this.info.bedsExplode ? this._bedBlast(ctx) : use ? use(ctx) : false);
  }

  _bedBlast(ctx) {
    const b = ctx.bed;
    const head = b?.head || [ctx.x, ctx.y, ctx.z];
    const list = [...head, BLOCK.AIR];
    if (b?.foot) list.push(...b.foot, BLOCK.AIR);
    this.world.setBlocks(list);
    const at = new THREE.Vector3(head[0] + 0.5, head[1] + 0.5, head[2] + 0.5);
    this.game.effects?.explode?.(at, { radius: BED_RADIUS, source: "bed" });
    // (vanilla's createFire: a third of the open cells over solid ground in reach)
    const w = this.world;
    const fires = [];
    const R = 5;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        for (let dy = -R; dy <= R; dy++) {
          if (dx * dx + dy * dy + dz * dz > R * R || Math.random() > 1 / 3) continue;
          const fx = head[0] + dx;
          const fy = head[1] + dy;
          const fz = head[2] + dz;
          if (w.getBlock(fx, fy, fz) === BLOCK.AIR && IS_SOLID[w.getBlock(fx, fy - 1, fz)]) fires.push(fx, fy, fz, FIRE);
        }
      }
    }
    if (fires.length) w.setBlocks(fires);
    return true;
  }

  // Water put where it boils away: a puff of steam.
  _evaporated(list) {
    const fx = this.game.effects?.smoke;
    if (!fx) return;
    for (let i = 0; i < list.length && i < 24; i += 3) {
      for (let k = 0; k < 4; k++) fx.spawn({ x: list[i] + Math.random(), y: list[i + 1] + 0.3 + Math.random() * 0.4, z: list[i + 2] + Math.random(), vy: 1 + Math.random(), life: 1.2, size0: 0.3, size1: 0.9, color0: SMOKE, alpha: 0.55, drag: 1.2 });
    }
    this.game.audio?.playExtinguish?.();
  }

  // ---------- Who simulates ----------

  // Whether this peer runs this dimension's world (fire, redstone, random
  // ticks): alone, always; the host, its own dimension; a guest, a
  // dimension the host is not in when it is the lowest player number there.
  simulatesWorld() {
    const mp = this.mp;
    if (!mp?.active) return !this.game.GUEST;
    if (mp.isHost) return true;
    if (!this.enabled) return false;
    const net = mp.net;
    const code = this.code;
    if ((net.players.get(HOST_PID)?.dim | 0) === code) return false;
    for (const p of net.players.values()) if (p.pid !== HOST_PID && p.pid < net.pid && (p.dim | 0) === code) return false;
    return true;
  }

  // ---------- Saves ----------

  // Every dimension's edits that changed (the Overworld's every time it is
  // the world's, as before): true if all were stored.
  saveEdits(seed, overworldCache) {
    let ok = true;
    this.world.forEachDim((dim, edits, dirty) => {
      if (dim !== this.world.dim && !dirty.size) return;
      let cache = overworldCache;
      if (dim !== OVERWORLD) {
        cache = this._caches.get(dim);
        if (!cache) this._caches.set(dim, (cache = new Map()));
      }
      // (A failed write keeps its chunks marked: tried again with the next save.)
      if (storeEdits(seed, edits, cache, dirty, dim)) dirty.clear();
      else ok = false;
    });
    return ok;
  }

  // (A guest saves nothing.)
  clearDirty() {
    this.world.forEachDim((dim, edits, dirty) => dirty.clear());
  }

  // A field of the save that stays the Overworld's (`water`, `mobs`): the
  // live one while the world is there, else the one kept aside.
  overworld(field, live) {
    if (!this.enabled || this.dim === OVERWORLD) return live();
    const s = this.stash.get(OVERWORLD);
    if (!s) return undefined;
    if (field === "water") return this._waterList(s);
    if (field === "mobs") return s.mobs?.length ? s.mobs : undefined;
    return undefined;
  }

  _waterList(s) {
    if (s.waterList) return s.waterList;
    const meta = s.water?.meta;
    if (!meta?.size || !this.game.waterSim) return undefined;
    // (Made once while its cells stay as they are: another peer's flow there
    // comes through waterMeta, which forgets it. Not every 5 s save.)
    return (s.waterSaved ||= this.game.waterSim.serializeMeta(WATER_CAP, meta));
  }

  // This dimension's and the other ones' state for the player's save:
  // { dim, dims } (see the top).
  serialize() {
    if (!this.enabled) return {};
    const dims = {};
    for (const dim of DIM_IDS) {
      if (dim === OVERWORLD) continue;
      let e;
      if (dim === this.dim) {
        const ws = this.game.waterSim;
        e = { water: ws?.meta.size ? ws.serializeMeta(WATER_CAP) : undefined, mobs: this.game.mobs?.serializeKept?.(), seeded: this.game.mobs?._seeded ? 1 : undefined };
      } else {
        const s = this.stash.get(dim);
        if (s) e = { water: this._waterList(s), mobs: s.mobs?.length ? s.mobs : undefined, seeded: s.seeded ? 1 : undefined };
      }
      if (e && (e.water || e.mobs || e.seeded)) dims[dim] = e;
    }
    const portals = this._savePortals();
    if (portals) dims.portals = portals;
    const out = Object.keys(dims).length ? dims : undefined;
    // (Saved under a portal trip's loading screen: back in the portal it
    // started from, not in ground never seen without a way back. Its pos
    // replaces main.js's, the held one.)
    const from = this.pending?.opts?.from;
    if (from && !this.player.dead) return { dim: from.dim !== OVERWORLD ? from.dim : undefined, pos: [from.x + 0.5, from.y, from.z + 0.5], dims: out };
    // (A dead player is saved as respawned: in the Overworld, or the Nether at a respawn anchor.)
    const here = this.player.dead ? this.respawnDimension() : this.dim;
    return { dim: here !== OVERWORLD ? here : undefined, dims: out };
  }

  // From the player's save, before the first frame (main.js, once everything
  // else is loaded): the other dimensions' state, and the world goes to the
  // dimension the save was made in, the player where they were.
  init(saved) {
    if (!this.enabled || !saved) return;
    const d = saved.dims && typeof saved.dims === "object" ? saved.dims : null;
    if (d) {
      for (const dim of DIM_IDS) {
        const e = dim !== OVERWORLD && d[dim];
        if (!e || typeof e !== "object") continue;
        const s = this._stashOf(dim);
        if (Array.isArray(e.water)) s.waterList = e.water;
        if (Array.isArray(e.mobs)) s.mobs = e.mobs.slice(0, 400);
        s.seeded = !!e.seeded;
      }
      this._loadPortals(d.portals);
    }
    const dim = dimId(saved.dim);
    if (dim === OVERWORLD) return;
    const p = this.player;
    const pos = Array.isArray(saved.pos) && saved.pos.length === 3 && saved.pos.every(Number.isFinite) ? saved.pos : null;
    // (No place: saved dead, as respawned. In the Nether only at a respawn
    // anchor (respawnDimension); anywhere else main.js's world spawn stands.)
    if (!pos) {
      const sleep = this.game.sleep;
      if (dim === NETHER && sleep?.spawn && sleep.spawnDim === NETHER) this._initAtAnchor(sleep);
      return;
    }
    this.enterNow(dim);
    const [x, y, z] = pos;
    this.world.prepareArea(x, z, 2);
    const w = this.world;
    const stuck = w.isSolidAt(Math.floor(x), Math.floor(y + 0.1), Math.floor(z)) || w.isSolidAt(Math.floor(x), Math.floor(y + 1.1), Math.floor(z));
    const spot = stuck ? this.safeSpot(x, y, z) || this.buildPlatform(x, y, z) : { x, y, z };
    this._place(spot);
  }

  // (A save made dead with a respawn anchor set: respawned at the anchor, a
  // charge used, as main.js's respawn; the anchor gone or empty: the world
  // spawn, in the Overworld (js/portal.js _anchorSpot took the world back).)
  _initAtAnchor(sleep) {
    this.enterNow(NETHER);
    this.world.prepareArea(sleep.spawn[0] + 0.5, sleep.spawn[2] + 0.5, 2);
    const spot = sleep.respawnSpot();
    if (spot) return this._place(spot);
    if (this.dim !== OVERWORLD) this.enterNow(OVERWORLD);
    const s = this.game.spawn || { x: 0, z: 0 };
    this.world.prepareArea(s.x + 0.5, s.z + 0.5, 2);
    this.player.spawnAt(s.x, s.z);
    this._place(this.player.position);
    this.game.toast?.("Your home bed was missing or obstructed", 4);
  }

  _place(spot) {
    const p = this.player;
    p.position.set(spot.x, spot.y, spot.z);
    p.velocity.set(0, 0, 0);
    p.resetFall?.();
    p.syncCamera?.();
    this.x.streamAround?.(spot.x, spot.z);
  }

  // ---------- Another dimension's water (js/net/world.js) ----------

  // The flow cells of `dim` (the live ones if the world is there).
  waterMeta(dim) {
    if (dim === this.dim) return this.game.waterSim?.meta || null;
    const s = this._stashOf(dim);
    if (!this._waterState(s)) s.water = { meta: new Map(), active: new Set() };
    s.waterSaved = undefined;
    return s.water.meta;
  }

  loadWaterMeta(dim, list) {
    if (dim === this.dim) {
      this.game.waterSim?.loadMeta(list);
      return;
    }
    const s = this._stashOf(dim);
    s.water = { meta: WaterSim.metaFromList(list), active: new Set() };
    s.waterList = s.waterSaved = undefined;
  }

  // ---------- Portals' places ----------

  _list(dim) {
    let l = this.portals.get(dim);
    if (!l) this.portals.set(dim, (l = []));
    return l;
  }

  // A portal block at (x, y, z) in `dim` (the portal parts: when one is
  // lit, its blocks or its lowest corner), for travellers to find. Online
  // the host keeps them all and tells everyone (send: false, when it is
  // their word coming in).
  addPortal(dim, x, y, z, send = true) {
    dim = dimId(dim);
    if (![x, y, z].every(Number.isInteger)) return;
    const l = this._list(dim);
    if (l.some((p) => p[0] === x && p[1] === y && p[2] === z)) return;
    if (l.length >= MAX_PORTALS) l.shift();
    l.push([x, y, z]);
    if (send) this.sync?.portal(1, dim, x, y, z);
  }

  removePortal(dim, x, y, z, send = true) {
    dim = dimId(dim);
    const l = this._list(dim);
    const i = l.findIndex((p) => p[0] === x && p[1] === y && p[2] === z);
    if (i < 0) return;
    l.splice(i, 1);
    if (send) this.sync?.portal(0, dim, x, y, z);
  }

  // The registered portal in `dim` nearest (x, y, z), within r blocks
  // across (vanilla's square search), or null.
  nearestPortal(dim, x, y, z, r) {
    let best = null;
    let bd = Infinity;
    for (const p of this.portals.get(dimId(dim)) || []) {
      if (Math.abs(p[0] + 0.5 - x) > r || Math.abs(p[2] + 0.5 - z) > r) continue;
      const d = (p[0] + 0.5 - x) ** 2 + (p[1] - y) ** 2 + (p[2] + 0.5 - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  _savePortals() {
    let out = null;
    for (const [dim, l] of this.portals) if (l.length) (out ||= {})[dim] = l.map((p) => p.slice());
    return out;
  }

  _loadPortals(data) {
    if (!data || typeof data !== "object") return;
    for (const dim of DIM_IDS) {
      if (!Array.isArray(data[dim])) continue;
      const l = [];
      for (const p of data[dim].slice(0, MAX_PORTALS)) if (Array.isArray(p) && p.length === 3 && p.every(Number.isInteger)) l.push(p.slice());
      this.portals.set(dim, l);
    }
  }

  // ---------- On screen ----------

  _showLoading(dim) {
    if (typeof document === "undefined") return;
    let el = this._loadEl;
    if (!el) {
      el = this._loadEl = document.createElement("div");
      el.id = "dim-loading";
      el.style.cssText = "position:fixed;inset:0;z-index:85;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#eee;font:600 22px sans-serif;text-shadow:2px 2px 0 #000;pointer-events:none";
      el.innerHTML = '<div class="t"></div><div class="s" style="font:15px sans-serif;color:#bbb">Building terrain</div>';
      document.body.appendChild(el);
    }
    const bg = { [NETHER]: "radial-gradient(circle, #3a0d0b, #120302)", [END]: "radial-gradient(circle, #241b2e, #07050a)" }[dim] || "radial-gradient(circle, #2a2620, #0c0b09)";
    el.style.background = bg;
    el.querySelector(".t").textContent = `Entering ${DIMS[dim].name}`;
    el.style.display = "flex";
  }

  _hideLoading() {
    if (this._loadEl) this._loadEl.style.display = "none";
  }

  // The nether portal's swirl closing in while the player waits in it.
  _showPortal(k) {
    if (typeof document === "undefined") return;
    if (!this._portalEl) {
      if (k <= 0) return;
      const el = (this._portalEl = document.createElement("div"));
      el.id = "dim-portal";
      el.style.cssText = "position:fixed;inset:0;z-index:4;pointer-events:none;background:radial-gradient(circle, rgba(120,40,200,0.35), rgba(90,10,170,0.85));opacity:0";
      document.body.appendChild(el);
    }
    const o = (k * 0.85).toFixed(3);
    if (this._portalEl.style.opacity !== o) this._portalEl.style.opacity = o;
  }

  // ---------- Testing (Creative) ----------

  // F7 in Creative: Overworld -> Nether -> End -> Overworld.
  _key(e) {
    if (e.code !== "F7" || e.repeat) return;
    if (!this.player.creative || this.game.gameState !== "playing") return;
    e.preventDefault();
    const order = [OVERWORLD, NETHER, END];
    this.debugTravel(order[(order.indexOf(this.dim) + 1) % order.length]);
  }

  // Straight to `dim` from where the player is (as through a portal, without one).
  debugTravel(dim) {
    dim = dimId(dim);
    if (dim === END) return this.travel(END, END_PLATFORM.x + 0.5, END_PLATFORM.y + 1, END_PLATFORM.z + 0.5, { place: "endPlatform", yaw: Math.PI / 2 });
    if (this.dim === END) return this.toSpawn();
    const p = this.player.position;
    const x = scaleBetween(this.dim, dim, p.x);
    const z = scaleBetween(this.dim, dim, p.z);
    const y = dim === NETHER ? Math.max(34, Math.min(110, p.y)) : this.world.terrainOf(dim).heightAt(Math.floor(x), Math.floor(z)) + 1;
    return this.travel(dim, x, y, z, { place: "safe" });
  }
}

// ---------- Online ----------

// The multiplayer module (main.js adds it: mp.addModule): this player's
// dimension to the host (the host's player list has everyone's), the
// creatures of a dimension the host is not in, the portals' places.
//   "dim"  { d: code }                   a guest's dimension changed (to the host)
//   "dpo"  { a: 1 | 0, d: code, p }      a portal registered or gone (to the host, which tells everyone)
export class DimSync {
  constructor(mp, dims) {
    this.mp = mp;
    this.net = mp.net;
    this.game = mp.game;
    this.dims = dims;
    this._away = false;
    const net = this.net;
    net.dimStamp = new Set([...DIM_DROP, "ps"]);
    net.dimDrop = new Set(DIM_DROP);
    net.dimCode = dims.code;
    if (mp.players) mp.players.onDimChange = (r) => this._remoteChanged(r);
    net.on("dim", (m, from) => this._onDim(m, from));
    net.on("dpo", (m, from) => this._onPortal(m, from));
    net.registerSync("dims", {
      save: () => ({ portals: dims._savePortals() }),
      load: (d) => dims._loadPortals(d?.portals),
    });
  }

  start() {
    this.net.dimCode = this.dims.code;
    this._away = false;
    if (this.net.isHost) this.net.setPlayerDim(this.net.pid, this.dims.code);
  }

  stop() {
    this._away = false;
  }

  stateLoaded() {
    this._tell();
  }

  // This player is about to change dimension: what it changed here goes first.
  beforeSwitch() {
    this.mp.world?.flushNow?.();
  }

  // This player changed dimension.
  changed() {
    const net = this.net;
    net.dimCode = this.dims.code;
    if (!this.mp.active) return;
    if (net.isHost) {
      net.setPlayerDim(net.pid, this.dims.code);
      // (Every guest gets the creatures of where it is from scratch.)
      this.mp.entities?.known?.clear?.();
    } else this._tell();
  }

  _tell() {
    if (this.mp.active && this.net.isClient && this.mp.stateLoaded) this.net.toHost({ t: "dim", d: this.dims.code });
  }

  // Host: a guest's word.
  _onDim(m, from) {
    if (!this.net.isHost) return;
    const c = m.d | 0;
    if (c < 0 || c >= DIM_IDS.length) return;
    this.net.setPlayerDim(from, c);
    this.mp.entities?.known?.delete?.(from);
  }

  // A remote player's state said another dimension (the host: they get its
  // creatures afresh when they come back).
  _remoteChanged(r) {
    if (this.net.isHost) this.mp.entities?.known?.delete?.(r.pid);
  }

  portal(add, dim, x, y, z) {
    if (!this.mp.active) return;
    const msg = { t: "dpo", a: add ? 1 : 0, d: codeOf(dim), p: [x, y, z] };
    if (this.net.isHost) this.net.broadcast(msg);
    else this.net.toHost(msg);
  }

  _onPortal(m, from) {
    if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isInteger)) return;
    const dim = DIM_IDS[m.d | 0] || OVERWORLD;
    const [x, y, z] = m.p;
    if (m.a) this.dims.addPortal(dim, x, y, z, false);
    else this.dims.removePortal(dim, x, y, z, false);
    if (this.net.isHost) this.net.broadcast(m, { except: from });
  }

  update() {
    if (!this.mp.active || this.net.isHost || !this.mp.stateLoaded) return;
    const away = (this.net.players.get(HOST_PID)?.dim | 0) !== this.dims.code;
    if (away !== this._away) {
      this._away = away;
      this._creatures(away);
    }
  }

  // A guest: the host's creatures while in the host's dimension (puppets,
  // js/net/entities.js), its own elsewhere (this round: not shared).
  _creatures(away) {
    const mobs = this.game.mobs;
    const es = this.mp.entities;
    if (!mobs) return;
    if (away) {
      if (es?.mobById) {
        for (const m of es.mobById.values()) es._removeMob?.(m);
        es.mobById.clear();
      }
      mobs.puppets = false;
    } else {
      for (let i = mobs.mobs.length - 1; i >= 0; i--) if (!mobs.mobs[i].spec.flies) mobs._remove(i);
      mobs.puppets = true;
    }
  }
}
