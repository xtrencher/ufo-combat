// The redstone simulation (Round 11), as Minecraft's: power from levers,
// buttons, pressure plates, redstone torches and blocks of redstone runs
// along dust (15, one less a block, up and down a block along steps),
// through conductors (a powered block powers the things beside it; a source
// fixed to a block powers it "strongly", and that reaches dust too) and
// repeaters (one way, 1-4 ticks of delay); torches invert the block they
// hang on (one tick); lamps light, doors, trapdoors and gates open, pistons
// push (up to 12 blocks) and sticky ones pull, TNT goes off and note blocks
// play when powered. What each block id is: js/content/redstone.js.
//
// Driven by block updates, in redstone ticks (0.1 s): an edit near a
// redstone block queues the components within two blocks of it; the
// queue settles within the tick (dust networks are recomputed as a whole:
// gathered from the changed dust, then power spread from the strongest
// source down); delays (torches, repeaters, buttons, a lamp going out)
// are scheduled ticks. Nothing runs while nothing changes, and a chunk with
// no redstone in it costs one look per edit. (Simplified where the engine
// forces it: pistons move their blocks at once, without the sliding, and
// don't shove creatures; no quasi-connectivity; repeaters don't lock.)
//
// TNT: primed by power, flint and steel (LIB.igniteTnt), fire beside it (as
// vanilla's fire burning it: a third of the fire's ticks) or a blast; it
// falls, flashes and after 4 s (a blast's: 0.5-1.5 s) explodes with power 4
// (effects.explode), breaking blocks (drops all of them in a Survival
// world, as vanilla's TNT) and setting off the TNT around it.
//
// Online the host simulates (main.js sets `enabled`): a guest's lever or
// button is an ordinary block edit that reaches the host's change listener,
// and the results go out as edits. A guest never primes TNT itself: flint
// and steel leaves TNT_LIT, its own blast TNT_LIT_SHORT, which the host
// primes. The host tells everyone of primed TNT (they draw it falling) and
// of the sounds it makes ("rs"; older peers ignore it). (Round 12) In a
// dimension the host is not in, the guest that simulates it there does
// (main.js: dims.simulatesWorld()).
//
// (Round 12) The gadgets (js/content/gadgets.js): an observer pulses (one
// tick on, after one tick) when the block its face looks at changes, out of
// its back (strongly into the block there); a dropper or dispenser fires two
// ticks after power comes (also when the block over it is powered: vanilla's
// quasi-connectivity), through onDispense (js/gadgets.js does the throwing);
// a hopper is locked while powered (powered(), asked by js/gadgets.js, which
// ticks the hoppers onHopper names); tripwire hooks facing each other with
// up to 40 tripwire between them are strung, and pulled (15, strongly into
// their wall) while anything stands on the string, until half a second
// after it leaves (players, creatures and items, like the plates). Their
// other events ride with "rs" (onEvent: js/gadgets.js's arrows in flight).
import * as THREE from "three";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_WET, IS_REPLACEABLE, IS_CHEST, BLOCK_LIMIT } from "./blocks.js";
import { WORLD_HEIGHT } from "./constants.js";
import { LIB } from "./content/base.js";
import * as I from "./content/ids.js";
import { K, KIND, VAR, ON, FLIP, ATTACH, FACING, WOOD, STICKY, FUSE, DX, DY, DZ, OPP, H4, HBIT, conductors, wireLinks, wirePoints, pistonId, headId, TNT_LIT_SHORT, hookIdOf, facing4Of } from "./content/redstone.js";
import { boxSlots } from "./content/gadgets.js";
import { itemModel } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { isVanilla } from "./worldtype.js";

export const TICK = 0.1; // a redstone tick (two game ticks)
const MAX_CATCHUP = 5; // ticks a slow frame catches up at most
const ROUNDS = 12; // settling passes in a tick (the rest waits for the next)
const MAX_NETWORK = 16384; // dust cells recomputed at once
const BUTTON_TICKS = [10, 15]; // stone 1 s, wood 1.5 s
const LAMP_OFF_TICKS = 2;
const PLATE_TICKS = 10; // a plate stays down this long after the last foot leaves
const PISTON_TICKS = 1;
const BURNOUT = { toggles: 8, within: 30, out: 80 }; // a torch flicking more than 8 times in 3 s goes dark for 8 s
export const TNT_FUSE = 4; // s
export const TNT_RADIUS = 16 / 3; // (effects.js units: vanilla's power 4, as a creeper's 4 is its power 3)
const MAX_TNT = 400;
const SCAN_EVERY = 0.25; // s: loaded chunks looked through for redstone (up to SCAN_MS of it a pass)
const SCAN_MS = 1.5;
const HEAR = 48; // blocks: how far a note block, a click or a piston is heard
// (Round 12) The gadgets' timings (vanilla's, in redstone ticks).
const OBSERVER_TICKS = 1; // (2 game ticks after the change, 2 on)
const DISPENSE_TICKS = 2; // (4 game ticks)
const STRING_TICKS = 5; // (a string stays pulled 10 game ticks after the last touch)
const HOOK_REACH = 41; // (up to 40 tripwire between two hooks)

// Cell keys: whole numbers (x and z within +-2^20, y 0-127).
const OFF = 1048576;
const SPAN = 2097152;
const key = (x, y, z) => ((x + OFF) * SPAN + (z + OFF)) * 128 + y;
let KX = 0;
let KY = 0;
let KZ = 0;
function unkey(k) {
  KY = k % 128;
  const r = (k - KY) / 128;
  const zz = r % SPAN;
  KZ = zz - OFF;
  KX = (r - zz) / SPAN - OFF;
}

// The cells within two blocks (|dx| + |dy| + |dz| <= 2) of a change.
const NEAR = [];
for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2) NEAR.push([dx, dy, dz]);

// What a simulation cares about: the redstone blocks (1), and the doors,
// trapdoors and fence gates it opens (OPEN: 1, 2, 3; OPENED: open now).
let REL = null;
let OPEN = null;
let OPENED = null;
function tables() {
  if (REL) return;
  REL = new Uint8Array(BLOCK_LIMIT);
  OPEN = new Uint8Array(BLOCK_LIMIT);
  OPENED = new Uint8Array(BLOCK_LIMIT);
  const known = (id) => !!BLOCK_INFO[id];
  for (let id = 0; id < BLOCK_LIMIT; id++) {
    if (KIND[id]) REL[id] = 1;
    if (known(id) && LIB.isDoor?.(id)) {
      OPEN[id] = 1;
      OPENED[id] = LIB.isOpenDoor(id) ? 1 : 0;
    }
  }
  for (const base of [I.OAK_TRAPDOOR, I.IRON_TRAPDOOR]) {
    for (let v = 0; v < 16; v++) {
      if (!known(base + v)) continue;
      OPEN[base + v] = 2;
      OPENED[base + v] = v & 4 ? 1 : 0;
    }
  }
  for (let k = 0; k < 6; k++) {
    for (let v = 0; v < 8; v++) {
      const id = I.OAK_FENCE_GATE + k * 8 + v;
      if (!known(id)) continue;
      OPEN[id] = 3;
      OPENED[id] = v & 4 ? 1 : 0;
    }
  }
  for (let id = 0; id < BLOCK_LIMIT; id++) if (OPEN[id]) REL[id] = 2;
}

// Event kinds (scheduled ticks).
const EV = { TORCH: 1, REPEATER: 2, LAMP: 3, BUTTON: 4, PISTON: 5, OBSERVER: 6, DISPENSE: 7 };
// What a piston does to a block in its way.
const PUSH = { EMPTY: 0, BREAK: 1, MOVE: 2, STOP: 3 };

export class RedstoneSim {
  // players: () => the other players (online: their livePos), for plates.
  constructor({ scene = null, world, effects = null, audio = null, entities = null, mobs = null, player = null, players = null } = {}) {
    this.world = world;
    this.effects = effects;
    this.entities = entities;
    this.mobs = mobs;
    this.player = player;
    this.players = players;
    this.enabled = () => true; // (main.js: the host, or a single player)
    this.send = null; // (main.js, online: the host's (msg) => broadcast)
    this.rand = Math.random;
    this.tick = 0;
    this._acc = 0;
    this._was = true; // (enabled at the last update)
    this._queue = new Set(); // cell keys to look at
    this._spare = new Set();
    this._events = new Map(); // cell key -> { at: tick, kind }
    this._plates = new Map(); // cell key -> the tick it was last stood on
    this._mem = new Map(); // cell key -> powered (doors, gates, trapdoors, note blocks: they act on a change)
    this._fireTnt = new Map(); // cell key -> the tick fire beside it gets its next chance
    this._toggles = new Map(); // cell key -> the ticks a torch changed at (burnout)
    this._burnt = new Map(); // cell key -> the tick a burnt-out torch may light again
    this._hot = new WeakMap(); // chunk -> 1 if it holds any redstone, 0 if not
    this._waiting = []; // { chunk, keys }: scanned, looked at once the ground round it is in
    this._scanT = 0;
    this._platesKnown = false;
    this._woodPlates = false;
    // (Round 12) Tripwire: cell key -> the tick something last stood on it.
    this._strings = new Map();
    this._stringsKnown = false;
    this.onDispense = null; // (x, y, z, id): a dropper or dispenser fires (js/gadgets.js)
    this.onHopper = null; // (x, y, z): a hopper seen (js/gadgets.js ticks it)
    this.onEvent = null; // (e): a guest, a gadget's event from the host's "rs"
    this._seeds = [];
    this._done = new Set();
    this._wireEdits = [];
    this._edits = [];
    this._after = [];
    this._ownWires = false;
    this._missing = false; // (a lookup fell in a chunk that isn't loaded: nothing is changed on half a picture)
    this._lc = null;
    this._lcx = 0;
    this._lcz = 0;
    // Dust networks (reused between computations).
    this._nKeys = [];
    this._nIdx = new Map();
    this._nSrc = [];
    this._nPow = [];
    this._nRev = [];
    this._buckets = Array.from({ length: 16 }, () => []);
    const sim = this;
    const nb = () => ({
      x: 0,
      y: 0,
      z: 0,
      get(dx, dy, dz) {
        return sim._get(this.x + dx, this.y + dy, this.z + dz);
      },
    });
    this._nbNet = nb();
    this._nbPts = nb();
    this.tnt = []; // primed TNT: { x, y, z, vx, vy, vz, fuse, visual, mesh, light }
    this._net = []; // events for the guests (the host online)
    this.stats = { ticks: 0, networks: 0, edits: 0, primed: 0 };
    this.group = null;
    if (scene) {
      this.group = new THREE.Group();
      scene.add(this.group);
      this.material = createEntityMaterial("array", world.atlas);
      this._flash = new THREE.Color(0.75, 0.75, 0.75);
    }
    this.sounds = new Sounds(audio);
    world.changeListeners.push((changed) => this._onChange(changed));
    effects?.blastListeners?.push((p, removed, r, info) => this._onBlast(p, removed, r, info));
    LIB.redstoneSim = this;
  }

  // ---------- Every frame ----------

  update(dt) {
    this._lc = null;
    if (this.tnt.length) this._updateTnt(dt);
    const on = this.enabled();
    if (on !== this._was) {
      this._was = on;
      this._reset();
    }
    if (on) {
      this._scanT -= dt;
      if (this._scanT <= 0) {
        this._scanT = SCAN_EVERY;
        this._scanLoaded();
      }
      this._acc = Math.min(this._acc + dt, TICK * MAX_CATCHUP);
      while (this._acc >= TICK) {
        this._acc -= TICK;
        this.step();
      }
    }
    if (this._net.length) {
      if (this.send) this.send({ t: "rs", e: this._net });
      this._net = [];
    }
  }

  // (Turned on or off: as for a world just loaded.)
  _reset() {
    this._queue.clear();
    this._events.clear();
    this._plates.clear();
    this._mem.clear();
    this._fireTnt.clear();
    this._toggles.clear();
    this._burnt.clear();
    this._strings.clear();
    this._hot = new WeakMap();
    this._waiting.length = 0;
    this._acc = 0;
    this._scanT = 0;
  }

  // One redstone tick.
  step() {
    this.tick++;
    this.stats.ticks++;
    this._lc = null;
    if (this._events.size) {
      for (const [k, ev] of this._events) {
        if (ev.at > this.tick) continue;
        this._events.delete(k);
        this._fire(k, ev.kind);
      }
    }
    if (this._platesKnown || this._stringsKnown) this._platesTick();
    if (this._fireTnt.size) this._fireTick();
    this._apply();
    for (let r = 0; r < ROUNDS && this._queue.size; r++) this._drain();
  }

  // ---------- Block access ----------

  _get(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;
    const cx = x >> 4;
    const cz = z >> 4;
    let c = this._lc;
    if (!c || this._lcx !== cx || this._lcz !== cz) {
      c = this.world.getChunk(cx, cz);
      if (!c) {
        this._missing = true;
        return BLOCK.AIR;
      }
      this._lc = c;
      this._lcx = cx;
      this._lcz = cz;
    }
    return c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }

  // ---------- Edits ----------

  _onChange(changed) {
    if (!this.enabled()) return;
    tables();
    this._lc = null;
    const missing = this._missing; // (an edit made in the middle of looking at a cell)
    const own = this._ownWires;
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const y = changed[i + 1];
      const z = changed[i + 2];
      const id = this._get(x, y, z);
      if (id === I.FIRE) this._nearFire(x, y, z);
      if (REL[id]) this._markHot(x, z);
      else if (!this._hotNear(x, z)) continue;
      // (Round 12) An observer looking at the cell sees it change.
      for (let d = 0; d < 6; d++) {
        const oy = y + DY[d];
        if (oy < 0 || oy >= WORLD_HEIGHT) continue;
        const o = this._get(x + DX[d], oy, z + DZ[d]);
        if (KIND[o] === K.OBSERVER && FACING[o] === OPP[d]) this._schedule(key(x + DX[d], oy, z + DZ[d]), OBSERVER_TICKS, EV.OBSERVER);
      }
      for (let n = 0; n < NEAR.length; n++) {
        const o = NEAR[n];
        const ny = y + o[1];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const b = this._get(x + o[0], ny, z + o[2]);
        // (our own dust edits: the dust round them is already worked out)
        if (!REL[b] || (own && KIND[b] === K.WIRE)) continue;
        this._queue.add(key(x + o[0], ny, z + o[2]));
      }
    }
    this._missing = missing;
  }

  // Whether the chunks within two blocks of (x, z) hold any redstone.
  _hotNear(x, z) {
    const a = (x - 2) >> 4;
    const b = (x + 2) >> 4;
    const c = (z - 2) >> 4;
    const d = (z + 2) >> 4;
    return this._chunkHot(a, c) || (b !== a && this._chunkHot(b, c)) || (d !== c && (this._chunkHot(a, d) || (b !== a && this._chunkHot(b, d))));
  }

  _chunkHot(cx, cz) {
    const c = this.world.getChunk(cx, cz);
    if (!c) return false;
    const v = this._hot.get(c);
    return (v === undefined ? this._scan(c) : v) === 1;
  }

  _markHot(x, z) {
    const c = this.world.getChunk(x >> 4, z >> 4);
    if (!c) return;
    if (this._hot.get(c) === undefined) this._scan(c);
    else this._hot.set(c, 1);
  }

  // Looks through a chunk once: whether it holds redstone, and its
  // redstone to look at once the chunks round it are loaded (a button
  // saved pressed, TNT a guest lit, a generated trap).
  _scan(c) {
    tables();
    const b = c.blocks;
    let hot = 0;
    const keys = [];
    for (let i = 0; i < b.length; i++) {
      const id = b[i];
      if (!REL[id]) continue;
      if (REL[id] === 1) {
        hot = 1;
        if (KIND[id] === K.PLATE) {
          this._platesKnown = true;
          if (WOOD[id]) this._woodPlates = true;
        } else if (KIND[id] === K.STRING) this._stringsKnown = true;
      }
      // (the doors too: how they're powered now, so a lever thrown later shuts one)
      keys.push(key(c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15)));
    }
    this._hot.set(c, hot);
    if (hot) this._waiting.push({ chunk: c, keys });
    return hot;
  }

  _scanLoaded() {
    const t0 = performance.now();
    for (const c of this.world.chunks.values()) {
      if (this._hot.has(c)) continue;
      this._scan(c);
      if (performance.now() - t0 > SCAN_MS) break;
    }
    if (!this._waiting.length) return;
    const w = this.world;
    const keep = [];
    for (const e of this._waiting) {
      const { cx, cz } = e.chunk;
      if (w.getChunk(cx, cz) !== e.chunk) continue;
      let ready = true;
      for (let dz = -1; dz <= 1 && ready; dz++) for (let dx = -1; dx <= 1; dx++) if (!w.getChunk(cx + dx, cz + dz)) ready = false;
      if (!ready) {
        keep.push(e);
        continue;
      }
      for (const k of e.keys) this._queue.add(k);
    }
    this._waiting = keep;
  }

  // Applies what a pass decided: the dust's new power, the other changes,
  // then what goes with them (drops, sounds, doors). Each change is
  // [x, y, z, from, to], made only where the block is still `from` (a piston
  // may have moved it meanwhile).
  _apply() {
    if (this._wireEdits.length) {
      const list = this._settled(this._wireEdits);
      this._wireEdits = [];
      this._ownWires = true;
      try {
        this.stats.edits += this.world.setBlocks(list);
      } finally {
        this._ownWires = false;
      }
    }
    if (this._edits.length) {
      const list = this._settled(this._edits);
      this._edits = [];
      this.stats.edits += this.world.setBlocks(list);
    }
    if (this._after.length) {
      const list = this._after;
      this._after = [];
      for (const fn of list) fn();
    }
  }

  _settled(changes) {
    const out = [];
    for (let i = 0; i < changes.length; i += 5) {
      if (this.world.getBlock(changes[i], changes[i + 1], changes[i + 2]) === changes[i + 3]) out.push(changes[i], changes[i + 1], changes[i + 2], changes[i + 4]);
    }
    return out;
  }

  // The block `id` at (x, y, z) turned on or off (FLIP), at the end of the pass.
  _flip(x, y, z, id) {
    this._edits.push(x, y, z, id, FLIP[id]);
  }

  // One settling pass: everything queued is looked at, dust networks worked out.
  _drain() {
    const q = this._queue;
    this._queue = this._spare;
    this._spare = q;
    this._seeds.length = 0;
    for (const k of q) this._evaluate(k);
    q.clear();
    this._done.clear();
    for (const k of this._seeds) if (!this._done.has(k)) this._network(k);
    this._apply();
  }

  _schedule(k, ticks, kind) {
    if (!this._events.has(k)) this._events.set(k, { at: this.tick + ticks, kind });
  }

  // ---------- Power ----------

  // The power the block `id` at (x, y, z) gives straight into the
  // component or dust beside it toward FACE d.
  _direct(id, x, y, z, d) {
    switch (KIND[id]) {
      case K.LEVER:
      case K.BUTTON:
      case K.PLATE:
        return ON[id] ? 15 : 0;
      case K.TORCH:
        return ON[id] && d !== ATTACH[id] ? 15 : 0;
      case K.RBLOCK:
        return 15;
      case K.REPEATER:
        return ON[id] && d === FACING[id] ? 15 : 0;
      case K.OBSERVER:
        return ON[id] && d === OPP[FACING[id]] ? 15 : 0;
      case K.HOOK:
        return ON[id] ? 15 : 0;
      case K.WIRE: {
        const p = VAR[id];
        if (!p || d === 2) return 0;
        if (d === 3) return p;
        const nb = this._nbPts;
        nb.x = x;
        nb.y = y;
        nb.z = z;
        return wirePoints(wireLinks(nb)) & HBIT[d] ? p : 0;
      }
    }
    return 0;
  }

  // The power the block `id` drives into the conductor toward FACE d: a
  // lever or button into the block it's on, a plate into the block under
  // it, a torch into the block over it, a repeater into the one in front.
  _strongFrom(id, d) {
    switch (KIND[id]) {
      case K.LEVER:
      case K.BUTTON:
        return ON[id] && d === ATTACH[id] ? 15 : 0;
      case K.PLATE:
        return ON[id] && d === 3 ? 15 : 0;
      case K.TORCH:
        return ON[id] && d === 2 ? 15 : 0;
      case K.REPEATER:
        return ON[id] && d === FACING[id] ? 15 : 0;
      case K.OBSERVER:
        return ON[id] && d === OPP[FACING[id]] ? 15 : 0;
      case K.HOOK:
        return ON[id] && d === ATTACH[id] ? 15 : 0;
    }
    return 0;
  }

  // A conductor's strong power (what reaches dust beside it).
  _strong(x, y, z) {
    let best = 0;
    for (let e = 0; e < 6 && best < 15; e++) best = Math.max(best, this._strongFrom(this._get(x + DX[e], y + DY[e], z + DZ[e]), OPP[e]));
    return best;
  }

  // A conductor's power, strong or from dust on it or pointing into it
  // (what reaches the components beside it).
  _blockPower(x, y, z) {
    let best = 0;
    for (let e = 0; e < 6 && best < 15; e++) {
      const nx = x + DX[e];
      const ny = y + DY[e];
      const nz = z + DZ[e];
      const id = this._get(nx, ny, nz);
      best = Math.max(best, this._strongFrom(id, OPP[e]));
      if (KIND[id] === K.WIRE && VAR[id]) best = Math.max(best, this._direct(id, nx, ny, nz, OPP[e]));
    }
    return best;
  }

  // The power reaching a component at (x, y, z) (from every side but `skip`).
  _input(x, y, z, skip = -1) {
    const cond = conductors();
    let best = 0;
    for (let d = 0; d < 6 && best < 15; d++) {
      if (d === skip) continue;
      const nx = x + DX[d];
      const ny = y + DY[d];
      const nz = z + DZ[d];
      const id = this._get(nx, ny, nz);
      best = Math.max(best, this._direct(id, nx, ny, nz, OPP[d]));
      if (cond[id]) best = Math.max(best, this._blockPower(nx, ny, nz));
    }
    return best;
  }

  // What dust at (x, y, z) gets from outside its network.
  _wireInput(x, y, z) {
    const cond = conductors();
    let best = 0;
    for (let d = 0; d < 6 && best < 15; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      const nz = z + DZ[d];
      const id = this._get(nx, ny, nz);
      if (KIND[id] === K.WIRE) continue;
      best = Math.max(best, this._direct(id, nx, ny, nz, OPP[d]));
      if (cond[id]) best = Math.max(best, this._strong(nx, ny, nz));
    }
    return best;
  }

  // Whether a torch should be lit: the block it hangs on is unpowered.
  _torchWants(x, y, z, id) {
    const a = ATTACH[id];
    const nx = x + DX[a];
    const ny = y + DY[a];
    const nz = z + DZ[a];
    const n = this._get(nx, ny, nz);
    if (KIND[n] === K.RBLOCK) return false;
    if (!conductors()[n]) return true;
    return this._blockPower(nx, ny, nz) === 0;
  }

  // A repeater's input, from behind it.
  _repeaterIn(x, y, z, id) {
    const f = FACING[id];
    const b = OPP[f];
    const nx = x + DX[b];
    const ny = y + DY[b];
    const nz = z + DZ[b];
    const n = this._get(nx, ny, nz);
    let v = this._direct(n, nx, ny, nz, f);
    if (conductors()[n]) v = Math.max(v, this._blockPower(nx, ny, nz));
    return v;
  }

  // ---------- Looking at a cell ----------

  _evaluate(k) {
    unkey(k);
    const x = KX;
    const y = KY;
    const z = KZ;
    this._missing = false;
    const id = this._get(x, y, z);
    if (this._missing) return;
    switch (KIND[id]) {
      case K.WIRE:
        this._seeds.push(k);
        this._nearWire(x, y, z);
        return;
      case K.TORCH: {
        const want = this._torchWants(x, y, z, id);
        if (!this._missing && want !== !!ON[id]) this._schedule(k, 1, EV.TORCH);
        return;
      }
      case K.REPEATER: {
        const inp = this._repeaterIn(x, y, z, id) > 0;
        if (!this._missing && inp !== !!ON[id]) this._schedule(k, VAR[id], EV.REPEATER);
        return;
      }
      case K.LAMP: {
        const inp = this._input(x, y, z) > 0;
        if (this._missing) return;
        if (inp) {
          this._events.delete(k);
          if (!ON[id]) this._flip(x, y, z, id);
        } else if (ON[id]) this._schedule(k, LAMP_OFF_TICKS, EV.LAMP);
        return;
      }
      case K.PISTON: {
        const p = this._input(x, y, z, FACING[id]) > 0;
        if (!this._missing && p !== !!ON[id]) this._schedule(k, PISTON_TICKS, EV.PISTON);
        return;
      }
      case K.TNT: {
        if (FUSE[id] >= 2) {
          this.prime(x, y, z, FUSE[id] === 3 ? this._blastFuse() : TNT_FUSE);
          return;
        }
        const p = this._input(x, y, z) > 0;
        if (this._missing) return;
        if (p) this.prime(x, y, z, TNT_FUSE);
        else this._fireCheck(x, y, z);
        return;
      }
      case K.NOTE: {
        const p = this._input(x, y, z) > 0;
        if (this._missing) return;
        const last = this._mem.get(k);
        this._mem.set(k, p);
        if (p && last === false) this.playNote(x, y, z, id);
        return;
      }
      case K.BUTTON:
        if (ON[id]) this._schedule(k, BUTTON_TICKS[WOOD[id]], EV.BUTTON);
        return;
      case K.PLATE:
        this._platesKnown = true;
        if (WOOD[id]) this._woodPlates = true;
        if (ON[id] && !this._plates.has(k)) this._plates.set(k, this.tick);
        return;
      // (Round 12) The gadgets.
      case K.HOPPER:
        this.onHopper?.(x, y, z);
        return;
      case K.DROPPER: {
        // (fired as power comes; the block over it counts too, vanilla's quasi-connectivity)
        const p = this._input(x, y, z) > 0 || (y + 1 < WORLD_HEIGHT && this._input(x, y + 1, z) > 0);
        if (this._missing) return;
        const last = this._mem.get(k);
        this._mem.set(k, p);
        if (p && last === false) this._schedule(k, DISPENSE_TICKS, EV.DISPENSE);
        return;
      }
      case K.OBSERVER:
        // (a pulse saved on, or cut short: it goes off)
        if (ON[id]) this._schedule(k, OBSERVER_TICKS, EV.OBSERVER);
        return;
      case K.HOOK:
        this._hookUpdate(x, y, z, id);
        return;
      case K.STRING:
        this._stringsKnown = true;
        this._lineHooks(x, y, z);
        return;
    }
    if (OPEN[id]) this._openUpdate(x, y, z, id);
  }

  // ---------- (Round 12) Tripwire ----------

  // A hook: strung when a line of tripwire (1-40) runs from it to a hook
  // facing it, pulled while something is on that line; the line's tripwire
  // marked strung or loose with it.
  _hookUpdate(x, y, z, id) {
    const f = FACING[id];
    let n = 0;
    let partner = false;
    let pulled = false;
    for (let i = 1; i <= HOOK_REACH; i++) {
      const cx = x + DX[f] * i;
      const cz = z + DZ[f] * i;
      const b = this._get(cx, y, cz);
      if (KIND[b] === K.HOOK && FACING[b] === OPP[f]) {
        partner = n > 0;
        break;
      }
      if (KIND[b] !== K.STRING) break;
      n++;
      if (this._strings.has(key(cx, y, cz))) pulled = true;
    }
    if (this._missing) return;
    const want = hookIdOf(facing4Of(f), partner, pulled);
    if (want !== id) {
      this._edits.push(x, y, z, id, want);
      this._sound("click", x, y, z, ON[want] || (VAR[want] && !VAR[id]) ? 1 : 0);
    }
    const sw = I.TRIPWIRE + (partner ? 1 : 0);
    for (let i = 1; i <= n; i++) {
      const cx = x + DX[f] * i;
      const cz = z + DZ[f] * i;
      const b = this._get(cx, y, cz);
      if (b !== sw) this._edits.push(cx, y, cz, b, sw);
    }
  }

  // The hooks at the ends of the tripwire through (x, y, z), to look at.
  _lineHooks(x, y, z) {
    for (const f of H4) {
      for (let i = 1; i <= HOOK_REACH; i++) {
        const cx = x + DX[f] * i;
        const cz = z + DZ[f] * i;
        const b = this._get(cx, y, cz);
        if (KIND[b] === K.STRING) continue;
        if (KIND[b] === K.HOOK && FACING[b] === OPP[f]) this._queue.add(key(cx, y, cz));
        break;
      }
    }
  }

  // Something on the tripwire at (x, y, z).
  _touchString(x, y, z, id) {
    const k = key(x, y, z);
    const fresh = !this._strings.has(k);
    this._strings.set(k, this.tick);
    if (fresh && VAR[id]) this._lineHooks(x, y, z);
  }

  // ---------- (Round 12) For js/gadgets.js ----------

  // Whether power reaches the block at (x, y, z) (a hopper's lock).
  powered(x, y, z) {
    this._lc = null;
    this._missing = false;
    tables();
    const p = this._input(x, y, z) > 0 && !this._missing;
    this._lc = null;
    return p;
  }

  // A gadget's event for the guests (with the host's "rs").
  event(e) {
    if (this.send) this._net.push(e);
  }

  // The components round dust that changed its links (where it points).
  _nearWire(x, y, z) {
    for (let n = 1; n < NEAR.length; n++) {
      const o = NEAR[n];
      const ny = y + o[1];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const b = this._get(x + o[0], ny, z + o[2]);
      if (REL[b] && KIND[b] !== K.WIRE) this._queue.add(key(x + o[0], ny, z + o[2]));
    }
  }

  // A door (both halves), trapdoor or fence gate: opens when power comes,
  // closes when it goes (a player may still work a wooden one between).
  _openUpdate(x, y, z, id) {
    const door = OPEN[id] === 1;
    const ly = door && BLOCK_INFO[id].partner?.[1] === -1 ? y - 1 : y;
    let p = this._input(x, ly, z) > 0;
    if (door && !p) p = this._input(x, ly + 1, z) > 0;
    if (this._missing) return;
    const lk = key(x, ly, z);
    const last = this._mem.get(lk);
    if (last === p) return;
    this._mem.set(lk, p);
    if (last === undefined && !p) return;
    const lower = this._get(x, ly, z);
    if (!!OPENED[lower] === p) return;
    this._after.push(() => {
      if (LIB.setOpen?.(this.world, x, ly, z, p)) this._sound("door", x, ly, z, p ? 1 : 0, BLOCK_INFO[lower]?.sound === "wood" ? 0 : 1);
    });
  }

  // ---------- Dust networks ----------

  // Gathers the dust joined to the dust at `start` (by any of the twelve
  // cells beside it, a step up or down: what links where is worked out
  // after) and sets each one's power: the most of its own input and of each
  // dust it links to, less one.
  _network(start) {
    const keys = this._nKeys;
    const idx = this._nIdx;
    keys.length = 0;
    idx.clear();
    keys.push(start);
    idx.set(start, 0);
    this._missing = false;
    for (let i = 0; i < keys.length && keys.length < MAX_NETWORK; i++) {
      unkey(keys[i]);
      const x = KX;
      const y = KY;
      const z = KZ;
      for (let h = 0; h < 4; h++) {
        const f = H4[h];
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= WORLD_HEIGHT || KIND[this._get(x + DX[f], ny, z + DZ[f])] !== K.WIRE) continue;
          const k = key(x + DX[f], ny, z + DZ[f]);
          if (!idx.has(k)) {
            idx.set(k, keys.length);
            keys.push(k);
          }
        }
      }
    }
    for (const k of keys) this._done.add(k);
    if (this._missing) return;
    this.stats.networks++;
    const n = keys.length;
    const src = this._nSrc;
    const pow = this._nPow;
    const rev = this._nRev;
    const cond = conductors();
    const nb = this._nbNet;
    for (let i = 0; i < n; i++) {
      if (!rev[i]) rev[i] = [];
      rev[i].length = 0;
    }
    for (let i = 0; i < n; i++) {
      unkey(keys[i]);
      const x = KX;
      const y = KY;
      const z = KZ;
      src[i] = this._wireInput(x, y, z);
      nb.x = x;
      nb.y = y;
      nb.z = z;
      const links = wireLinks(nb);
      // (each dust this one links to powers it: an edge from that one to this)
      for (let h = 0; h < 4; h++) {
        if (!(links & (1 << h))) continue;
        const f = H4[h];
        const nx = x + DX[f];
        const nz = z + DZ[f];
        const side = this._get(nx, y, nz);
        let ny = -1;
        if (KIND[side] === K.WIRE) ny = y;
        else if (links & (16 << h)) ny = y + 1;
        else if (!cond[side] && KIND[this._get(nx, y - 1, nz)] === K.WIRE) ny = y - 1;
        if (ny < 0) continue;
        const j = idx.get(key(nx, ny, nz));
        if (j !== undefined) rev[j].push(i);
      }
    }
    if (this._missing) return;
    const buckets = this._buckets;
    for (let p = 0; p < 16; p++) buckets[p].length = 0;
    for (let i = 0; i < n; i++) {
      pow[i] = src[i];
      if (src[i] > 0) buckets[src[i]].push(i);
    }
    for (let p = 15; p > 1; p--) {
      const list = buckets[p];
      for (let b = 0; b < list.length; b++) {
        const i = list[b];
        if (pow[i] !== p) continue;
        const out = rev[i];
        for (let e = 0; e < out.length; e++) {
          const j = out[e];
          if (pow[j] < p - 1) {
            pow[j] = p - 1;
            buckets[p - 1].push(j);
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      unkey(keys[i]);
      const id = this._get(KX, KY, KZ);
      if (KIND[id] === K.WIRE && VAR[id] !== pow[i]) this._wireEdits.push(KX, KY, KZ, id, I.REDSTONE_WIRE + pow[i]);
    }
  }

  // ---------- Scheduled ticks ----------

  _fire(k, kind) {
    unkey(k);
    const x = KX;
    const y = KY;
    const z = KZ;
    this._missing = false;
    const id = this._get(x, y, z);
    if (this._missing) return;
    switch (kind) {
      case EV.TORCH: {
        if (KIND[id] !== K.TORCH) return;
        let want = this._torchWants(x, y, z, id);
        if (this._missing) return;
        const until = this._burnt.get(k);
        if (until !== undefined) {
          if (until > this.tick) want = false;
          else {
            this._burnt.delete(k);
            this._toggles.delete(k);
          }
        }
        if (want === !!ON[id]) return;
        if (want) {
          // (lit again: counted toward burning out)
          let list = this._toggles.get(k);
          if (!list) this._toggles.set(k, (list = []));
          list.push(this.tick);
          while (list.length && list[0] < this.tick - BURNOUT.within) list.shift();
          if (list.length > BURNOUT.toggles) {
            this._burnt.set(k, this.tick + BURNOUT.out);
            this._schedule(k, BURNOUT.out + 1, EV.TORCH);
            this._sound("fizz", x, y, z);
            return;
          }
        }
        this._flip(x, y, z, id);
        return;
      }
      case EV.REPEATER: {
        if (KIND[id] !== K.REPEATER) return;
        const inp = this._repeaterIn(x, y, z, id) > 0;
        if (this._missing) return;
        if (!ON[id]) {
          this._flip(x, y, z, id);
          // (a pulse shorter than the delay still comes out the delay long)
          if (!inp) this._schedule(k, VAR[id], EV.REPEATER);
        } else if (!inp) this._flip(x, y, z, id);
        return;
      }
      case EV.LAMP:
        if (KIND[id] === K.LAMP && ON[id] && !(this._input(x, y, z) > 0) && !this._missing) this._flip(x, y, z, id);
        return;
      case EV.BUTTON:
        if (KIND[id] === K.BUTTON && ON[id]) {
          this._flip(x, y, z, id);
          this._sound("click", x, y, z, 0);
        }
        return;
      case EV.PISTON: {
        if (KIND[id] !== K.PISTON) return;
        const p = this._input(x, y, z, FACING[id]) > 0;
        if (this._missing) return;
        if (p && !ON[id]) this._extend(x, y, z, id);
        else if (!p && ON[id]) this._retract(x, y, z, id);
        return;
      }
      case EV.OBSERVER:
        if (KIND[id] !== K.OBSERVER) return;
        // (on, and off again a tick later)
        if (!ON[id]) this._schedule(k, OBSERVER_TICKS, EV.OBSERVER);
        this._flip(x, y, z, id);
        return;
      case EV.DISPENSE:
        if (KIND[id] === K.DROPPER) this.onDispense?.(x, y, z, id);
    }
  }

  // ---------- Pressure plates ----------

  _platesTick() {
    const p = this.player;
    if (p && !p.dead && !p.vehicle) this._press(p.position.x, p.position.y, p.position.z, 0.3, false);
    if (this.players) {
      for (const r of this.players()) {
        if (r.dead || r.vehicleNid) continue;
        const at = r.livePos || r.position;
        if (at) this._press(at.x, at.y, at.z, 0.3, false);
      }
    }
    for (const m of this.mobs?.mobs || []) if (!m.dead && !m.isRemotePlayer && m.pos) this._press(m.pos.x, m.pos.y, m.pos.z, 0.3, false);
    if (this._woodPlates || this._stringsKnown) for (const it of this.entities?.items || []) this._press(it.pos.x, it.pos.y - 0.25, it.pos.z, 0.125, true);
    // (Round 12) Tripwire left alone for half a second lets go.
    if (this._strings.size) {
      for (const [k, t] of this._strings) {
        if (this.tick - t < STRING_TICKS) continue;
        this._strings.delete(k);
        unkey(k);
        const sx = KX;
        const sy = KY;
        const sz = KZ;
        if (VAR[this._get(sx, sy, sz)]) this._lineHooks(sx, sy, sz);
      }
    }
    for (const [k, t] of this._plates) {
      if (this.tick - t < PLATE_TICKS) continue;
      this._plates.delete(k);
      unkey(k);
      const id = this._get(KX, KY, KZ);
      if (KIND[id] === K.PLATE && ON[id]) {
        this._flip(KX, KY, KZ, id);
        this._sound("click", KX, KY, KZ, 0);
      }
    }
  }

  // Something with its feet at (px, py, pz), r wide each way, on a plate?
  _press(px, py, pz, r, item) {
    const y = Math.floor(py + 1e-3);
    if (py - y > 0.3 || y < 0 || y >= WORLD_HEIGHT) return;
    const x0 = Math.floor(px - r);
    const x1 = Math.floor(px + r);
    const z0 = Math.floor(pz - r);
    const z1 = Math.floor(pz + r);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const id = this._get(x, y, z);
        if (KIND[id] === K.STRING) {
          this._touchString(x, y, z, id);
          continue;
        }
        if (KIND[id] !== K.PLATE || (item && !WOOD[id])) continue;
        const k = key(x, y, z);
        if (!ON[id] && !this._plates.has(k)) {
          this._flip(x, y, z, id);
          this._sound("click", x, y, z, 1);
        }
        this._plates.set(k, this.tick);
      }
    }
    this._missing = false;
  }

  // ---------- Pistons ----------

  _push(b) {
    if (b === BLOCK.AIR) return PUSH.EMPTY;
    const info = BLOCK_INFO[b];
    if (!info) return PUSH.STOP;
    if (KIND[b] === K.HEAD || (KIND[b] === K.PISTON && ON[b])) return PUSH.STOP;
    if (b === I.OBSIDIAN || (info.hardness < 0 && !info.liquid)) return PUSH.STOP;
    // (things that keep items by their place: chests, furnaces, the magic blocks)
    // (Round 12: and the gadgets that hold items, and the workstations' blocks)
    if (IS_CHEST[b] || (b >= 1792 && b <= 1855) || boxSlots(b) || (b >= 2816 && b <= 2879)) return PUSH.STOP;
    if (info.liquid || IS_REPLACEABLE[b] || !info.solid || info.partner || info.support || KIND[b] === K.REPEATER) return PUSH.BREAK;
    return PUSH.MOVE;
  }

  _extend(x, y, z, id) {
    const f = FACING[id];
    const dx = DX[f];
    const dy = DY[f];
    const dz = DZ[f];
    const line = [];
    let broken = BLOCK.AIR;
    let cx = x + dx;
    let cy = y + dy;
    let cz = z + dz;
    for (;;) {
      if (cy < 0 || cy >= WORLD_HEIGHT) return;
      const b = this._get(cx, cy, cz);
      if (this._missing) return;
      const r = this._push(b);
      if (r === PUSH.BREAK) broken = b;
      if (r === PUSH.EMPTY || r === PUSH.BREAK) break;
      if (r === PUSH.STOP || line.length >= 12) return;
      line.push(b);
      cx += dx;
      cy += dy;
      cz += dz;
    }
    const list = [];
    for (let k = line.length - 1; k >= 0; k--) list.push(x + dx * (k + 2), y + dy * (k + 2), z + dz * (k + 2), line[k]);
    list.push(x + dx, y + dy, z + dz, headId(STICKY[id], f), x, y, z, pistonId(STICKY[id], f, 1));
    this.world.setBlocks(list);
    // (what was in the way drops as if it came off by itself)
    if (broken !== BLOCK.AIR && !BLOCK_INFO[broken]?.liquid && broken !== I.FIRE) this.world.onBlockPopped?.(cx, cy, cz, broken);
    this._sound("piston", x, y, z, 1);
  }

  _retract(x, y, z, id) {
    const f = FACING[id];
    const sticky = STICKY[id];
    const hx = x + DX[f];
    const hy = y + DY[f];
    const hz = z + DZ[f];
    const head = this._get(hx, hy, hz);
    const list = [x, y, z, pistonId(sticky, f, 0)];
    if (KIND[head] === K.HEAD && FACING[head] === f) {
      let pulled = BLOCK.AIR;
      if (sticky) {
        const bx = hx + DX[f];
        const by = hy + DY[f];
        const bz = hz + DZ[f];
        const b = by >= 0 && by < WORLD_HEIGHT ? this._get(bx, by, bz) : BLOCK.AIR;
        if (this._missing) return;
        if (this._push(b) === PUSH.MOVE) {
          pulled = b;
          list.push(bx, by, bz, BLOCK.AIR);
        }
      }
      list.push(hx, hy, hz, pulled);
    }
    this.world.setBlocks(list);
    this._sound("piston", x, y, z, 0);
  }

  // ---------- TNT ----------

  // The TNT at (x, y, z) goes off in `fuse` seconds (the host's). True if primed.
  prime(x, y, z, fuse = TNT_FUSE) {
    this._lc = null;
    if (KIND[this.world.getBlock(x, y, z)] === K.TNT) this.world.setBlock(x, y, z, BLOCK.AIR);
    this._spawnTnt(x + 0.5, y, z + 0.5, fuse);
    return true;
  }

  _blastFuse() {
    return 0.5 + this.rand(); // (vanilla: 10-29 game ticks)
  }

  // Primed TNT at (x, y, z) (the bottom of its middle). visual: another
  // machine's (it only falls and flashes here).
  _spawnTnt(x, y, z, fuse, visual = false, vel = null) {
    if (this.tnt.length >= MAX_TNT) {
      if (visual) return null;
      fuse = Math.min(fuse, 0.05);
    }
    const a = this.rand() * Math.PI * 2;
    const t = {
      x,
      y,
      z,
      vx: vel ? vel[0] : -Math.sin(a) * 0.4,
      vy: vel ? vel[1] : 4,
      vz: vel ? vel[2] : -Math.cos(a) * 0.4,
      fuse,
      visual,
      mesh: null,
      light: { sky: 15, block: 0, flash: null },
      lightT: 0,
    };
    if (this.group) {
      const model = itemModel(I.TNT);
      if (model) {
        t.mesh = new THREE.Mesh(model.geometry, this.material);
        t.mesh.castShadow = true;
        t.mesh.receiveShadow = true;
        bindEntityLight(t.mesh, () => t.light);
        this.group.add(t.mesh);
      }
    }
    this.tnt.push(t);
    if (!visual) {
      this.stats.primed++;
      this._sound("fuse", x, y, z);
      if (this.send) this._net.push(["t", r2(x), r2(y), r2(z), r2(t.vx), r2(t.vy), r2(t.vz), r2(fuse)]);
    }
    return t;
  }

  _updateTnt(dt) {
    const w = this.world;
    const drag = Math.pow(0.98, dt * 20);
    for (let i = this.tnt.length - 1; i >= 0; i--) {
      const t = this.tnt[i];
      t.fuse -= dt;
      // (vanilla: 0.04 blocks a tick down, 2% drag a tick, 0.7 on the ground)
      t.vy = Math.max(-40, t.vy - 16 * dt);
      t.vx *= drag;
      t.vy *= drag;
      t.vz *= drag;
      const nx = t.x + t.vx * dt;
      if (this._boxSolid(nx, t.y, t.z)) t.vx = 0;
      else t.x = nx;
      const nz = t.z + t.vz * dt;
      if (this._boxSolid(t.x, t.y, nz)) t.vz = 0;
      else t.z = nz;
      const ny = t.y + t.vy * dt;
      if (this._boxSolid(t.x, ny, t.z)) {
        if (t.vy < 0) {
          t.y = Math.max(Math.min(t.y, Math.floor(ny) + 1), ny);
          const f = Math.pow(0.7, dt * 20);
          t.vx *= f;
          t.vz *= f;
        }
        t.vy = 0;
      } else t.y = ny;
      if (t.mesh) {
        t.lightT -= dt;
        if (t.lightT <= 0) {
          t.lightT = 0.2;
          const l = w.lightAt(t.x, t.y + 0.5, t.z);
          t.light.sky = l.sky;
          t.light.block = l.block;
        }
        // (vanilla: white every other quarter second, swelling in its last half second)
        t.light.flash = Math.floor(t.fuse * 4) % 2 === 0 ? this._flash : null;
        const end = Math.max(0, 1 - t.fuse / 0.5);
        const s = 0.98 * (1 + Math.pow(end, 4) * 0.3);
        t.mesh.scale.setScalar(s);
        t.mesh.position.set(t.x, t.y + s / 2, t.z);
      }
      if (t.fuse > 0 && t.y > -16) continue;
      this.tnt.splice(i, 1);
      if (t.mesh) this.group.remove(t.mesh);
      if (!t.visual && t.y > -16) this._detonate(t);
    }
  }

  _boxSolid(x, y, z) {
    const w = this.world;
    const r = 0.49;
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) {
      for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++) {
        for (let by = Math.floor(y); by <= Math.floor(y + 0.98); by++) if (IS_SOLID[w.getBlock(bx, by, bz)]) return true;
      }
    }
    return false;
  }

  _detonate(t) {
    if (!this.effects) return;
    const at = new THREE.Vector3(t.x, t.y + 1 / 16, t.z);
    // (in water it breaks nothing, as vanilla)
    const wet = !!IS_WET[this.world.getBlock(t.x, t.y + 0.5, t.z)];
    const removed = this.effects.explode(at, { radius: TNT_RADIUS, source: "tnt", carve: !wet });
    // (a Survival world: every block it breaks drops, as vanilla's TNT)
    if (Array.isArray(removed) && removed.length && isVanilla()) this.mobs?.blastDrops?.(removed, at, 1);
  }

  // A blast: primed TNT near it is thrown; TNT blocks it reached go off
  // (here, the host's; a guest leaves them for the host).
  _onBlast(pos, removed, radius, info) {
    const reach = radius * 1.5;
    for (const t of this.tnt) {
      const dx = t.x - pos.x;
      const dy = t.y + 0.49 - pos.y;
      const dz = t.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= reach || d < 1e-3) continue;
      const k = (20 * (1 - d / reach)) / d;
      t.vx += dx * k;
      t.vy += dy * k;
      t.vz += dz * k;
    }
    if (info?.mirror || !removed?.length) return;
    let marks = null;
    let gone = null;
    const host = this.enabled();
    for (let i = 0; i < removed.length; i += 4) {
      const id = removed[i + 3];
      // (a piston's head blown away with its base: one piston drops, the base's)
      if (KIND[id] === K.HEAD) {
        if (!gone) {
          gone = new Set();
          for (let j = 0; j < removed.length; j += 4) gone.add(key(removed[j], removed[j + 1], removed[j + 2]));
        }
        const f = FACING[id];
        if (gone.has(key(removed[i] - DX[f], removed[i + 1] - DY[f], removed[i + 2] - DZ[f]))) removed[i + 3] = -1;
        continue;
      }
      if (!(id >= 0) || KIND[id] !== K.TNT) continue;
      removed[i + 3] = -1; // (it goes off: nothing to drop)
      if (host) this._spawnTnt(removed[i] + 0.5, removed[i + 1], removed[i + 2] + 0.5, this._blastFuse());
      else (marks ||= []).push(removed[i], removed[i + 1], removed[i + 2], TNT_LIT_SHORT);
    }
    if (marks) this.world.setBlocks(marks);
  }

  // Fire beside TNT: a chance every 1.5-2 s while it burns (a third; 40%
  // above or below it), as vanilla's fire catching it.
  _nearFire(x, y, z) {
    for (let d = 0; d < 6; d++) {
      const id = this._get(x + DX[d], y + DY[d], z + DZ[d]);
      if (KIND[id] === K.TNT && FUSE[id] === 1) this._fireCheck(x + DX[d], y + DY[d], z + DZ[d]);
    }
  }

  _fireCheck(x, y, z) {
    for (let d = 0; d < 6; d++) {
      if (this._get(x + DX[d], y + DY[d], z + DZ[d]) !== I.FIRE) continue;
      const k = key(x, y, z);
      if (!this._fireTnt.has(k)) this._fireTnt.set(k, this.tick + 15 + Math.floor(this.rand() * 6));
      return;
    }
  }

  _fireTick() {
    for (const [k, at] of this._fireTnt) {
      if (at > this.tick) continue;
      unkey(k);
      const x = KX;
      const y = KY;
      const z = KZ;
      this._missing = false;
      const id = this._get(x, y, z);
      let odds = 0;
      if (KIND[id] === K.TNT && FUSE[id] === 1) for (let d = 0; d < 6; d++) if (this._get(x + DX[d], y + DY[d], z + DZ[d]) === I.FIRE) odds = Math.max(odds, d === 2 || d === 3 ? 0.4 : 1 / 3);
      if (this._missing) continue;
      if (!odds) this._fireTnt.delete(k);
      else if (this.rand() < odds) {
        this._fireTnt.delete(k);
        this.prime(x, y, z, TNT_FUSE);
      } else this._fireTnt.set(k, this.tick + 15 + Math.floor(this.rand() * 6));
    }
  }

  // ---------- Sounds ----------

  _sound(kind, x, y, z, a = 0, b = 0) {
    this._play(kind, x, y, z, a, b);
    if (this.send) this._net.push(["s", kind, x, y, z, a, b]);
  }

  _play(kind, x, y, z, a, b) {
    const l = this.effects?.listener;
    const dist = l ? Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y, z + 0.5 - l.z) : 0;
    if (dist > HEAR) return;
    this.sounds.play(kind, dist, a, b);
  }

  // A lever, button or repeater clicked here (js/content/redstone.js).
  click(x, y, z, on) {
    this._sound("click", x, y, z, on ? 1 : 0);
  }

  // A note block plays its pitch, with the instrument of the block under it
  // (and only with air over it, as vanilla).
  playNote(x, y, z, id) {
    const w = this.world;
    if (w.getBlock(x, y + 1, z) !== BLOCK.AIR) return;
    this._sound("note", x, y, z, VAR[id], instrumentOf(w.getBlock(x, y - 1, z)));
  }

  // ---------- Online (a guest) ----------

  // The host's "rs": primed TNT to draw and sounds to play.
  onMessage(m) {
    if (!m || !Array.isArray(m.e)) return;
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    for (const e of m.e.slice(0, 256)) {
      if (!Array.isArray(e)) continue;
      if (e[0] === "t" && e.slice(1, 8).every(num) && e[2] > -64 && e[2] < 256) {
        this._spawnTnt(e[1], e[2], e[3], Math.min(8, Math.max(0, e[7])), true, [e[4], e[5], e[6]].map((v) => Math.max(-60, Math.min(60, v))));
      } else if (e[0] === "s" && typeof e[1] === "string" && e.slice(2, 7).every(num)) {
        this._play(e[1], e[2], e[3], e[4], e[5], e[6]);
      } else if (typeof e[0] === "string" && e[0][0] === "g") this.onEvent?.(e); // (Round 12: a gadget's)
    }
  }

  // Everything primed goes (a new world, a reset).
  clear() {
    for (const t of this.tnt) if (t.mesh) this.group.remove(t.mesh);
    this.tnt.length = 0;
    this._reset();
  }
}

const r2 = (v) => Math.round(v * 100) / 100;

// ---------- Note blocks ----------

export const INSTRUMENTS = ["harp", "bass", "basedrum", "snare", "hat", "bell", "flute", "chime", "guitar", "xylophone", "iron_xylophone", "didgeridoo", "bit", "banjo"];
const INST = Object.fromEntries(INSTRUMENTS.map((n, i) => [n, i]));
// The instrument a block under a note block gives (vanilla's: wood a bass,
// sand and gravel a snare, glass a hat, stone a bass drum, wool a guitar,
// gold a bell, clay a flute, packed ice a chime...; anything else the harp).
let SPECIAL = null;
function instrumentOf(below) {
  SPECIAL ||= new Map([
    [I.GOLD_BLOCK, "bell"],
    [I.CLAY, "flute"],
    [I.PACKED_ICE, "chime"],
    [I.IRON_BLOCK, "iron_xylophone"],
    [I.PUMPKIN, "didgeridoo"],
    [I.EMERALD_BLOCK, "bit"],
    [I.HAY_BLOCK, "banjo"],
  ]);
  const special = SPECIAL.get(below);
  if (special) return INST[special];
  const b = BLOCK_INFO[below];
  const s = b?.sound;
  if (s === "wood") return INST.bass;
  if (s === "sand" && below !== BLOCK.SNOW) return INST.snare;
  if (s === "glass") return INST.hat;
  if (s === "stone" && b.tool === "pickaxe") return INST.basedrum;
  if (s === "cloth") return INST.guitar;
  return INST.harp;
}
// Octaves from the harp's (F#3 at pitch 0, vanilla's), by instrument.
const OCTAVE = [0, -2, 0, 0, 0, 2, 1, 2, -1, 2, 0, -2, 0, 0];

// The redstone sounds, made on the spot with the game's audio context (its
// "blocks" bus and volume).
class Sounds {
  constructor(audio) {
    this.audio = audio;
    this._noise = null;
  }

  _start(gain) {
    const a = this.audio;
    const ctx = a?.ctx;
    if (!ctx || gain < 0.01) return null;
    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(a.buses?.blocks || a.master || ctx.destination);
    return { ctx, out, t: ctx.currentTime };
  }

  _noiseSrc(ctx, t, d) {
    if (!this._noise) {
      const n = ctx.sampleRate;
      this._noise = ctx.createBuffer(1, n, n);
      const data = this._noise.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.start(t, Math.random() * 0.5, d + 0.05);
    return src;
  }

  // A burst of filtered noise.
  _hit(s, type, f, q, d, v, attack = 0.003) {
    const { ctx, out, t } = s;
    const src = this._noiseSrc(ctx, t, d + attack);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + d);
    src.connect(filter).connect(g).connect(out);
  }

  // A tone: oscillator `type` at f Hz, decaying over d seconds.
  _tone(s, type, f, d, v, attack = 0.004, f1 = null) {
    const { ctx, out, t } = s;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + d);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + attack + d + 0.05);
    return g;
  }

  play(kind, dist, a = 0, b = 0) {
    const s = this._start(1 / (1 + Math.max(0, dist) / 12));
    if (!s) return;
    if (kind === "click") {
      this._hit(s, "bandpass", a ? 2300 : 1900, 4, 0.03, 0.22);
      this._tone(s, "square", a ? 900 : 760, 0.02, 0.03);
    } else if (kind === "piston") {
      this._hit(s, "lowpass", a ? 700 : 520, 1, 0.16, 0.4);
      this._tone(s, "sine", a ? 110 : 90, 0.12, 0.25, 0.004, 55);
    } else if (kind === "fuse") {
      this._hit(s, "highpass", 2600, 0.7, 1.1, 0.12, 0.08);
    } else if (kind === "fizz") {
      this._hit(s, "bandpass", 3400, 1.2, 0.35, 0.1, 0.02);
    } else if (kind === "door") {
      this.audio.playDistant?.(dist, () => this.audio.playPlace?.(b ? "stone" : "wood"));
    } else if (kind === "note") this._note(s, a, b);
  }

  _note(s, pitch, inst) {
    const name = INSTRUMENTS[inst] || "harp";
    const f = 185 * Math.pow(2, Math.max(0, Math.min(24, pitch)) / 12 + (OCTAVE[inst] || 0));
    const rate = Math.pow(2, (pitch - 12) / 12); // (the drums are played faster or slower)
    switch (name) {
      case "basedrum":
        this._tone(s, "sine", 120 * rate, 0.22, 0.55, 0.003, 42 * rate);
        this._hit(s, "lowpass", 900 * rate, 1, 0.06, 0.2);
        break;
      case "snare":
        this._hit(s, "bandpass", 1900 * rate, 0.9, 0.16, 0.4);
        this._tone(s, "triangle", 210 * rate, 0.08, 0.15);
        break;
      case "hat":
        this._hit(s, "highpass", 6500 * rate, 1, 0.05, 0.25);
        break;
      case "bass":
      case "guitar":
      case "banjo":
      case "didgeridoo":
        this._tone(s, name === "banjo" ? "square" : "sawtooth", f, name === "didgeridoo" ? 0.9 : name === "banjo" ? 0.35 : 0.6, 0.16, name === "didgeridoo" ? 0.05 : 0.004);
        break;
      case "bell":
      case "chime":
        this._tone(s, "sine", f, 1.6, 0.3);
        this._tone(s, "sine", f * 2.76, 0.9, 0.08);
        break;
      case "flute":
        this._tone(s, "sine", f, 0.7, 0.3, 0.04);
        break;
      case "xylophone":
      case "iron_xylophone":
        this._tone(s, "sine", f, 0.35, 0.32);
        this._tone(s, "sine", f * 3.9, 0.12, 0.06);
        break;
      case "bit":
        this._tone(s, "square", f, 0.4, 0.12);
        break;
      default:
        this._tone(s, "triangle", f, 0.9, 0.34);
        this._tone(s, "sine", f * 2, 0.5, 0.08);
    }
  }
}
