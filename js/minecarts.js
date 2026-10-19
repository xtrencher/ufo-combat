// Minecarts and the rails' redstone (Round 12), vanilla Java 1.20's.
//
// A cart's tick (cartTick, 20 a second; js/boats.js runs the vehicles) is
// AbstractMinecart's: gravity, then on a rail moveAlongTrack (the speed
// turned along the rail, slopes pulling it down 1/128 a tick, a powered
// rail pushing 0.06 a tick along (and off a block behind it when nearly
// still), an unpowered one braking by half, a rider's forward key nudging
// a cart that is nearly still; 0.4 blocks a tick at most (0.75 of the
// speed with a rider), friction 0.997 ridden, 0.96 empty, 0.98-0.995 with
// a chest by how full it is, the height lost on a slope turned into speed),
// off a rail comeOffTrack (half the speed on the ground, 0.95 in the air).
// An activator rail that is powered throws the rider out. (Where it differs:
// a cart on rails keeps no fall speed; carts carry nothing through portals.)
//
// The rails' redstone (RailSystem): a rail put down by this player turns
// itself and the rails it joins (content/transport.js railPlace); the peer
// that runs this dimension's world (the host, js/dimensions.js) powers the
// powered and activator rails (a rail with redstone power beside it, and up
// to 8 more along the line from it), flips a junction when its power
// changes (the south-east rule, north-west while powered), and turns a
// detector rail on while a cart is on it (off a second after the last one
// leaves): an ordinary block edit, the redstone's own (the redstone sees a
// detector rail that is on as a source, like a block of redstone: power to
// what is beside it; vanilla's also powers the block under it strongly).
import * as THREE from "three";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_OPAQUE, IS_WET } from "./blocks.js";
import { sweepAxis } from "./physics.js";
import { DETECTOR_RAIL } from "./content/ids.js";
import { KIND, K } from "./content/redstone.js";
import { RAIL_KIND, RAIL_SHAPE, RAIL_ON, EXITS, NS, EW, ASC_E, ASC_W, ASC_N, ASC_S, isRail, isAscending, withPower, railOverlay, railPlace, railPotential, signalAt, sturdyTop, K_RAIL, K_POWERED, K_DETECTOR, K_ACTIVATOR } from "./content/transport.js";
import { isLava } from "./content/nature.js";

// (A detector rail with a cart on it powers what is beside it: to the
// redstone, a source like a block of redstone.)
for (let s = 0; s < 6; s++) KIND[DETECTOR_RAIL + 6 + s] = K.RBLOCK;

export const CART_R = 0.49; // (half of vanilla's 0.98)
export const CART_H = 0.7;
const SLOPE = 0.0078125;
const GRAVITY = 0.04;
const MAX_SPEED = 0.4;
const DETECTOR_HOLD = 1; // s (vanilla checks again 20 ticks after a cart came)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const conductor = (w, x, y, z) => {
  const id = w.getBlock(x, y, z);
  return IS_SOLID[id] === 1 && IS_OPAQUE[id] === 1;
};

// Where a cart at (x, y, z) sits on the rail under it (vanilla's getPos),
// or null off the rails.
export function railPos(w, x, y, z, out = {}) {
  const i = Math.floor(x);
  let j = Math.floor(y);
  const k = Math.floor(z);
  if (isRail(w.getBlock(i, j - 1, k))) j--;
  const id = w.getBlock(i, j, k);
  if (!isRail(id)) return null;
  const [a, b] = EXITS[RAIL_SHAPE[id]];
  const x0 = i + 0.5 + a[0] * 0.5;
  const y0 = j + 0.0625 + a[1] * 0.5;
  const z0 = k + 0.5 + a[2] * 0.5;
  const dx = b[0] * 0.5 + 0.5 + i - x0;
  const dy = (j + 0.0625 + b[1] * 0.5 - y0) * 2;
  const dz = b[2] * 0.5 + 0.5 + k - z0;
  let t;
  if (dx === 0) t = z - k;
  else if (dz === 0) t = x - i;
  else t = ((x - x0) * dx + (z - z0) * dz) * 2;
  out.x = x0 + dx * t;
  out.y = y0 + dy * t + (dy < 0 ? 1 : dy > 0 ? 0.5 : 0);
  out.z = z0 + dz * t;
  return out;
}

// The cart's box moved by (mx, my, mz) against the blocks; a blocked axis
// loses its speed (Entity.move). Returns whether it came to rest on something.
function moveBox(w, v, mx, my, mz, r, h) {
  const p = v.pos;
  let ground = false;
  if (my) {
    const d = sweepAxis(w, p, r, h, "y", my);
    p.y += d;
    if (Math.abs(d - my) > 1e-7) {
      if (my < 0) ground = true;
      v.vel.y = 0;
    }
  }
  if (mx) {
    const d = sweepAxis(w, p, r, h, "x", mx);
    p.x += d;
    if (Math.abs(d - mx) > 1e-7) v.vel.x = 0;
  }
  if (mz) {
    const d = sweepAxis(w, p, r, h, "z", mz);
    p.z += d;
    if (Math.abs(d - mz) > 1e-7) v.vel.z = 0;
  }
  return ground;
}

// How full a chest is to a comparator (0-15).
export function chestSignal(slots, maxStack) {
  if (!slots) return 0;
  let f = 0;
  let any = false;
  for (const s of slots) {
    if (!s) continue;
    any = true;
    f += s.count / (maxStack(s.id) || 64);
  }
  return any ? Math.floor((f / slots.length) * 14) + 1 : 0;
}

const _before = {};
const _after = {};

// One tick of a cart. env: { world, inWater(v), riderPush(v) => [x, z] | null,
// eject(v), ridden(v), signal(v) (a chest cart's comparator reading) }.
export function cartTick(v, env) {
  const w = env.world;
  if (v.hurtTime > 0) v.hurtTime--;
  if (v.damage > 0) v.damage--;
  const wet = env.inWater(v);
  v.inLava = isLava(w.getBlock(Math.floor(v.pos.x), Math.floor(v.pos.y + 0.2), Math.floor(v.pos.z)));
  v.vel.y -= wet ? 0.005 : GRAVITY;
  const bx = Math.floor(v.pos.x);
  let by = Math.floor(v.pos.y);
  const bz = Math.floor(v.pos.z);
  if (isRail(w.getBlock(bx, by - 1, bz))) by--;
  const id = w.getBlock(bx, by, bz);
  v.onRail = isRail(id);
  if (v.onRail) {
    v.fall = 0;
    alongTrack(v, env, bx, by, bz, id, wet);
    if (RAIL_KIND[id] === K_ACTIVATOR && RAIL_ON[id]) {
      if (env.ridden(v)) env.eject(v);
      if (v.hurtTime === 0) {
        v.hurtDir = -v.hurtDir;
        v.hurtTime = 10;
        v.damage = 50;
      }
    }
  } else offTrack(v, env, wet);
  // The way it faces: along its motion (either end first), tilted on a slope.
  const mx = v.pos.x - v.lastX;
  const mz = v.pos.z - v.lastZ;
  if (mx * mx + mz * mz > 1e-6) {
    let yaw = Math.atan2(-mx, -mz);
    let d = yaw - v.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > Math.PI / 2) yaw += Math.PI;
    v.yaw = yaw;
  }
  v.lastX = v.pos.x;
  v.lastZ = v.pos.z;
  const shape = v.shape;
  v.pitch = 0;
  if (isAscending(shape)) {
    // (nose up when the front points uphill)
    const fx = -Math.sin(v.yaw);
    const fz = -Math.cos(v.yaw);
    const up = shape === ASC_E ? fx : shape === ASC_W ? -fx : shape === ASC_N ? -fz : fz;
    v.pitch = up > 0 ? Math.PI / 4 : -Math.PI / 4;
  }
}

function alongTrack(v, env, bx, by, bz, id, wet) {
  const w = env.world;
  const p = v.pos;
  const vel = v.vel;
  const before = railPos(w, p.x, p.y, p.z, _before);
  let y = by;
  const kind = RAIL_KIND[id];
  const powered = kind === K_POWERED && !!RAIL_ON[id];
  let brake = kind === K_POWERED && !powered;
  const slope = wet ? SLOPE * 0.2 : SLOPE;
  const shape = RAIL_SHAPE[id];
  if (shape === ASC_E) vel.x -= slope;
  else if (shape === ASC_W) vel.x += slope;
  else if (shape === ASC_N) vel.z += slope;
  else if (shape === ASC_S) vel.z -= slope;
  if (isAscending(shape)) y++;
  const [a, b] = EXITS[shape];
  let dx = b[0] - a[0];
  let dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  if (vel.x * dx + vel.z * dz < 0) {
    dx = -dx;
    dz = -dz;
  }
  const sp = Math.min(2, Math.hypot(vel.x, vel.z));
  vel.x = (sp * dx) / len;
  vel.z = (sp * dz) / len;
  // (A rider walking forward nudges a cart that is nearly still.)
  const push = env.riderPush(v);
  if (push && push[0] * push[0] + push[1] * push[1] > 1e-4 && vel.x * vel.x + vel.z * vel.z < 0.01) {
    vel.x += push[0] * 0.1;
    vel.z += push[1] * 0.1;
    brake = false;
  }
  if (brake) {
    if (Math.hypot(vel.x, vel.z) < 0.03) vel.set(0, 0, 0);
    else {
      vel.x *= 0.5;
      vel.z *= 0.5;
    }
  }
  const x0 = bx + 0.5 + a[0] * 0.5;
  const z0 = bz + 0.5 + a[2] * 0.5;
  dx = b[0] * 0.5 - a[0] * 0.5;
  dz = b[2] * 0.5 - a[2] * 0.5;
  let t;
  if (dx === 0) t = p.z - bz;
  else if (dz === 0) t = p.x - bx;
  else t = ((p.x - x0) * dx + (p.z - z0) * dz) * 2;
  p.x = x0 + dx * t;
  p.z = z0 + dz * t;
  p.y = y;
  const k = env.ridden(v) ? 0.75 : 1;
  const max = wet ? MAX_SPEED / 2 : MAX_SPEED;
  moveBox(w, v, clamp(k * vel.x, -max, max), 0, clamp(k * vel.z, -max, max), CART_R, CART_H);
  // (off the end of a slope: up or down the block)
  if (a[1] !== 0 && Math.floor(p.x) - bx === a[0] && Math.floor(p.z) - bz === a[2]) p.y += a[1];
  else if (b[1] !== 0 && Math.floor(p.x) - bx === b[0] && Math.floor(p.z) - bz === b[2]) p.y += b[1];
  // Friction.
  const f = v.chest ? 0.98 + (15 - env.signal(v)) * 0.001 : env.ridden(v) ? 0.997 : 0.96;
  vel.x *= f * (wet ? 0.95 : 1);
  vel.z *= f * (wet ? 0.95 : 1);
  const after = railPos(w, p.x, p.y, p.z, _after);
  if (after && before) {
    const d = (before.y - after.y) * 0.05;
    const h = Math.hypot(vel.x, vel.z);
    if (h > 0) {
      vel.x *= (h + d) / h;
      vel.z *= (h + d) / h;
    }
    p.y = after.y;
  } else if (after) p.y = after.y;
  const fx = Math.floor(p.x);
  const fz = Math.floor(p.z);
  if (fx !== bx || fz !== bz) {
    const h = Math.hypot(vel.x, vel.z);
    vel.x = h * (fx - bx);
    vel.z = h * (fz - bz);
  }
  if (powered) {
    const h = Math.hypot(vel.x, vel.z);
    if (h > 0.01) {
      vel.x += (vel.x / h) * 0.06;
      vel.z += (vel.z / h) * 0.06;
    } else if (shape === EW) {
      if (conductor(w, bx - 1, by, bz)) vel.x = 0.02;
      else if (conductor(w, bx + 1, by, bz)) vel.x = -0.02;
    } else if (shape === NS) {
      if (conductor(w, bx, by, bz - 1)) vel.z = 0.02;
      else if (conductor(w, bx, by, bz + 1)) vel.z = -0.02;
    }
  }
  vel.y = 0;
  v.shape = shape;
}

function offTrack(v, env, wet) {
  const w = env.world;
  const vel = v.vel;
  const max = wet ? MAX_SPEED / 2 : MAX_SPEED;
  v.shape = -1;
  vel.x = clamp(vel.x, -max, max);
  vel.z = clamp(vel.z, -max, max);
  if (v.onGround) vel.multiplyScalar(0.5);
  const y0 = v.pos.y;
  v.onGround = moveBox(w, v, vel.x, vel.y, vel.z, CART_R, CART_H);
  if (!v.onGround) vel.multiplyScalar(0.95);
  v.fall = v.onGround || wet ? 0 : Math.max(0, (v.fall || 0) + y0 - v.pos.y);
}

// ---------- The model ----------

// Boxes as one geometry for the entity "array" material: each box
// [x0, y0, z0, x1, y1, z1, layer] (blocks, around the origin), every face
// the tile cut to the face's size (at most a whole tile).
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], u: 2, v: 1 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], u: 2, v: 1 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], u: 0, v: 2 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: 0, v: 2 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], u: 0, v: 1 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], u: 0, v: 1 },
];
export function boxesGeometry(boxes) {
  const pos = [];
  const nor = [];
  const uv = [];
  const layer = [];
  const idx = [];
  for (const b of boxes) {
    const lo = [b[0], b[1], b[2]];
    const hi = [b[3], b[4], b[5]];
    const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    for (const f of FACES) {
      const base = pos.length / 3;
      const su = Math.min(1, size[f.u]);
      const sv = Math.min(1, size[f.v]);
      for (const c of f.c) {
        pos.push(c[0] ? hi[0] : lo[0], c[1] ? hi[1] : lo[1], c[2] ? hi[2] : lo[2]);
        nor.push(...f.n);
        const cu = f === FACES[0] || f === FACES[5] ? 1 - c[f.u] : c[f.u];
        uv.push(cu * su, c[f.v] * sv);
        layer.push(b[6]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aLayer", new THREE.Float32BufferAttribute(layer, 1));
  g.setIndex(idx);
  return g;
}

// A minecart: an open iron tub 1.125 long, 0.875 wide, 0.6875 high (the
// floor 3/16 up), its front along -Z.
export const CART_FLOOR = 3 / 16;
export function cartGeometry(layer) {
  const T = 1 / 16;
  const X = 0.4375;
  const Z = 0.5625;
  const H = 0.6875;
  return boxesGeometry([
    [-X, T, -Z, X, CART_FLOOR, Z, layer],
    [-X, T, -Z, -X + T, H, Z, layer],
    [X - T, T, -Z, X, H, Z, layer],
    [-X + T, T, -Z, X - T, H, -Z + T, layer],
    [-X + T, T, Z - T, X - T, H, Z, layer],
    // (the frame under it, a little narrower)
    [-X + 2 * T, 0, -Z + 2 * T, X - 2 * T, T, Z - 2 * T, layer],
  ]);
}

// ---------- The rails' redstone ----------

const key = (x, y, z) => `${x},${y},${z}`;
// (the cells within two blocks of a change: a rail there may see its power change)
const NEAR = [];
for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2) NEAR.push([dx, dy, dz]);
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// (an ascending rail's high side, the block it leans on)
const HIGH = { [ASC_E]: [1, 0], [ASC_W]: [-1, 0], [ASC_N]: [0, -1], [ASC_S]: [0, 1] };

export class RailSystem {
  // simulates(): this peer runs this dimension's world (powers, junctions, detectors).
  constructor({ world, simulates = () => true }) {
    this.world = world;
    this.simulates = simulates;
    this._busy = 0;
    this._placed = []; // rails put down here: [x, y, z, ...]
    this._near = []; // changed cells near rails: [x, y, z, ...]
    this._hot = new WeakMap(); // chunk -> 1 if it holds a rail
    this._junctions = new Map(); // key -> powered (the last time it was looked at)
    this._detectors = new Map(); // key -> { x, y, z, seen } (on now)
    this._queued = false;
    this._scanT = 0;
    this.stats = { placed: 0, powered: 0, detectors: 0 };
    world.changeListeners.push((changed, opts) => this._onChange(changed, opts));
  }

  _onChange(changed, opts) {
    if (this._busy) return;
    const w = this.world;
    let any = false;
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const y = changed[i + 1];
      const z = changed[i + 2];
      const id = w.getBlock(x, y, z);
      if (isRail(id)) {
        this._markHot(x, z);
        if (!opts?.remote) this._placed.push(x, y, z);
        any = true;
      }
      if (!this._hotNear(x, z)) continue;
      this._near.push(x, y, z);
      any = true;
      // An ascending rail whose high side is no longer a block to lean on comes off (vanilla's).
      if (!opts?.remote && !sturdyTop(id)) {
        for (const [dx, dz] of SIDES) {
          const r = w.getBlock(x - dx, y, z - dz);
          const h = HIGH[RAIL_SHAPE[r]];
          if (isRail(r) && h && h[0] === dx && h[1] === dz && isAscending(RAIL_SHAPE[r])) this._pop(x - dx, y, z - dz, r);
        }
      }
    }
    if (any && !this._queued) {
      this._queued = true;
      queueMicrotask(() => this.flush());
    }
  }

  _pop(x, y, z, id) {
    this._busy++;
    try {
      if (this.world.setBlocks([x, y, z, BLOCK.AIR]) && this.world.onBlockPopped) this.world.onBlockPopped(x, y, z, id);
    } finally {
      this._busy--;
    }
  }

  _apply(list) {
    if (!list.length) return 0;
    this._busy++;
    try {
      return this.world.setBlocks(list);
    } finally {
      this._busy--;
    }
  }

  // Whether the chunks within two blocks of (x, z) hold any rail.
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
    if (c) this._hot.set(c, 1);
  }

  // Looks through a chunk once for rails (and detector rails left on: they go off if no cart comes).
  _scan(c) {
    const b = c.blocks;
    let hot = 0;
    for (let i = 0; i < b.length; i++) {
      const id = b[i];
      if (!RAIL_KIND[id]) continue;
      hot = 1;
      if (RAIL_KIND[id] === K_DETECTOR && RAIL_ON[id]) {
        const x = c.cx * 16 + (i & 15);
        const y = i >> 8;
        const z = c.cz * 16 + ((i >> 4) & 15);
        this._detectors.set(key(x, y, z), { x, y, z, seen: performance.now() / 1000 });
      }
    }
    this._hot.set(c, hot);
    return hot;
  }

  // What waits from the edits: the rails put down turn, the redstone's results.
  flush() {
    this._queued = false;
    const w = this.world;
    if (this._placed.length) {
      const list = this._placed;
      this._placed = [];
      for (let i = 0; i < list.length; i += 3) {
        const [x, y, z] = [list[i], list[i + 1], list[i + 2]];
        const id = w.getBlock(x, y, z);
        if (!isRail(id)) continue;
        const ov = railOverlay(w);
        railPlace(ov, x, y, z, id, signalAt(x, y, z) > 0, true);
        const edits = ov.list();
        this.stats.placed++;
        if (edits.length) {
          this._apply(edits);
          for (let k = 0; k < edits.length; k += 4) this._near.push(edits[k], edits[k + 1], edits[k + 2]);
        }
      }
    }
    if (!this._near.length) return;
    const near = this._near;
    this._near = [];
    if (!this.simulates()) return;
    const lines = new Set();
    const junctions = new Set();
    for (let i = 0; i < near.length; i += 3) {
      const x = near[i];
      const y = near[i + 1];
      const z = near[i + 2];
      for (const [dx, dy, dz] of NEAR) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        const id = w.getBlock(nx, ny, nz);
        const kind = RAIL_KIND[id];
        if (!kind) continue;
        const k = key(nx, ny, nz);
        if (kind === K_POWERED || kind === K_ACTIVATOR) lines.add(k);
        else if (kind === K_RAIL && Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 1) junctions.add(k);
      }
    }
    const done = new Set();
    for (const k of lines) {
      if (done.has(k)) continue;
      const [x, y, z] = k.split(",").map(Number);
      this._line(x, y, z, done);
    }
    for (const k of junctions) {
      const [x, y, z] = k.split(",").map(Number);
      this._junction(x, y, z, k);
    }
  }

  // A junction (three rails round it) turns when its power changes.
  _junction(x, y, z, k) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (RAIL_KIND[id] !== K_RAIL) return;
    const ov = railOverlay(w);
    if (railPotential(ov, x, y, z, id) !== 3) {
      this._junctions.delete(k);
      return;
    }
    const on = signalAt(x, y, z) > 0;
    if ((this._junctions.get(k) ?? false) === on) return;
    this._junctions.set(k, on);
    if (this._junctions.size > 4096) this._junctions.clear();
    railPlace(ov, x, y, z, id, on, false);
    this._apply(ov.list());
  }

  // The powered (or activator) rails of one line through (x, y, z): each on
  // if redstone power is beside it or beside one of the next 8 along the line.
  _line(x, y, z, done) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    const cells = [[x, y, z, id]];
    for (const fwd of [true, false]) {
      let c = cells[0];
      for (let n = 0; n < 9; n++) {
        c = this._next(c, fwd);
        if (!c) break;
        cells.push(c);
      }
    }
    const out = [];
    for (const c of cells) {
      const k = key(c[0], c[1], c[2]);
      if (done.has(k)) continue;
      done.add(k);
      const want = this._wants(c);
      if (want !== !!RAIL_ON[c[3]]) out.push(c[0], c[1], c[2], withPower(c[3], want));
    }
    this.stats.powered += out.length / 4;
    this._apply(out);
  }

  _wants(c) {
    if (signalAt(c[0], c[1], c[2]) > 0) return true;
    for (const fwd of [true, false]) {
      let n = c;
      for (let d = 0; d < 8; d++) {
        n = this._next(n, fwd);
        if (!n) break;
        if (signalAt(n[0], n[1], n[2]) > 0) return true;
      }
    }
    return false;
  }

  // The next rail of the same kind along the line (vanilla's
  // findPoweredRailSignal steps), or null.
  _next([x, y, z, id], fwd) {
    let shape = RAIL_SHAPE[id];
    let down = true;
    switch (shape) {
      case NS:
        z += fwd ? 1 : -1;
        break;
      case EW:
        x += fwd ? -1 : 1;
        break;
      case ASC_E:
        if (fwd) x--;
        else {
          x++;
          y++;
          down = false;
        }
        shape = EW;
        break;
      case ASC_W:
        if (fwd) {
          x--;
          y++;
          down = false;
        } else x++;
        shape = EW;
        break;
      case ASC_N:
        if (fwd) z++;
        else {
          z--;
          y++;
          down = false;
        }
        shape = NS;
        break;
      case ASC_S:
        if (fwd) {
          z++;
          y++;
          down = false;
        } else z--;
        shape = NS;
        break;
      default:
        return null;
    }
    const kind = RAIL_KIND[id];
    const same = (nid) => {
      if (RAIL_KIND[nid] !== kind) return false;
      const s = RAIL_SHAPE[nid];
      if (shape === EW && (s === NS || s === ASC_N || s === ASC_S)) return false;
      if (shape === NS && (s === EW || s === ASC_E || s === ASC_W)) return false;
      return true;
    };
    const w = this.world;
    let nid = w.getBlock(x, y, z);
    if (same(nid)) return [x, y, z, nid];
    if (!down) return null;
    nid = w.getBlock(x, y - 1, z);
    return same(nid) ? [x, y - 1, z, nid] : null;
  }

  // Per frame (the world's runner): the detector rails under `carts` (the
  // carts of this dimension, anyone's) on, those without one for a second off.
  update(dt, carts) {
    if (!this.simulates()) {
      this._detectors.clear();
      return;
    }
    const w = this.world;
    const now = performance.now() / 1000;
    let on = null;
    for (const v of carts) {
      const x = Math.floor(v.pos.x);
      const z = Math.floor(v.pos.z);
      let y = Math.floor(v.pos.y);
      let id = w.getBlock(x, y, z);
      if (!isRail(id)) id = w.getBlock(x, --y, z);
      if (RAIL_KIND[id] !== K_DETECTOR) continue;
      const k = key(x, y, z);
      const d = this._detectors.get(k);
      if (d) d.seen = now;
      else this._detectors.set(k, { x, y, z, seen: now });
      if (!RAIL_ON[id]) (on ||= []).push(x, y, z, withPower(id, true));
    }
    let off = null;
    for (const [k, d] of this._detectors) {
      const id = w.getBlock(d.x, d.y, d.z);
      if (RAIL_KIND[id] !== K_DETECTOR) {
        if (w.getChunk(d.x >> 4, d.z >> 4)) this._detectors.delete(k);
        continue;
      }
      if (now - d.seen < DETECTOR_HOLD) continue;
      this._detectors.delete(k);
      if (RAIL_ON[id]) (off ||= []).push(d.x, d.y, d.z, withPower(id, false));
    }
    for (const list of [on, off]) {
      if (!list) continue;
      this.stats.detectors += list.length / 4;
      this._apply(list);
      // (the powered rails beside them: their power changed)
      for (let i = 0; i < list.length; i += 4) this._near.push(list[i], list[i + 1], list[i + 2]);
    }
    if ((on || off) && !this._queued) {
      this._queued = true;
      queueMicrotask(() => this.flush());
    }
    // (detector rails left on in a chunk that just came in)
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = 0.5;
      const t0 = performance.now();
      for (const c of w.chunks.values()) {
        if (this._hot.has(c)) continue;
        this._scan(c);
        if (performance.now() - t0 > 1) break;
      }
    }
  }

  clear() {
    this._detectors.clear();
    this._junctions.clear();
    this._placed.length = 0;
    this._near.length = 0;
  }
}

export { IS_WET, BLOCK_INFO };
