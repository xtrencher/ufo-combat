// Transport (Round 12): rails, boats and minecarts, vanilla Java 1.20's.
//
// Blocks: the rail (straight, sloped, curved), the powered rail (a boost
// while powered, a brake while not), the detector rail (power while a cart
// is on it) and the activator rail (a powered one throws a cart's rider
// out). A rail's shape is its id (ids.js: base + shape, the powered ones
// + 6 when on), worked out as vanilla's RailState does: placed, a rail
// joins the rails beside it (and one step up or down, on a slope), bending
// into a curve where two meet at a corner (the plain rail only); a rail
// already joined at both ends is left alone; at a T or a crossing the
// south-east rule picks the curve (north-west when the rail is powered).
// railPlace() below is that rule; js/minecarts.js runs it when a rail goes
// down (the neighbours bend to it), and flips the junctions and powers the
// rails as the redstone changes.
// Items: the boat of each wood and its chest boat, the minecart and the
// minecart with a chest (js/boats.js and js/minecarts.js are the vehicles:
// placing one is LIB.transport's, set by them).
// The rails' faces are drawn as one quad 1/16 over the floor (a slope: from
// 1/16 up to a block and 1/16), like vanilla's models.
import { BLOCK, ITEM, RENDER, FACE, LIB, BLOCK_LIMIT } from "./base.js";
import * as I from "./ids.js";

// ---------- Rail shapes ----------

export const NS = 0; // north-south (north is -Z)
export const EW = 1;
export const ASC_E = 2; // rising toward +X
export const ASC_W = 3;
export const ASC_N = 4; // rising toward -Z
export const ASC_S = 5;
export const SE = 6;
export const SW = 7;
export const NW = 8;
export const NE = 9;
export const isAscending = (shape) => shape >= ASC_E && shape <= ASC_S;

// Vanilla's exits of each shape, [dx, dy, dz] from the middle of the cell
// (the low end of a slope at dy -1): where a cart comes in and goes out.
export const EXITS = [
  [[0, 0, -1], [0, 0, 1]],
  [[-1, 0, 0], [1, 0, 0]],
  [[-1, -1, 0], [1, 0, 0]],
  [[-1, 0, 0], [1, -1, 0]],
  [[0, 0, -1], [0, -1, 1]],
  [[0, -1, -1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0]],
  [[0, 0, 1], [-1, 0, 0]],
  [[0, 0, -1], [-1, 0, 0]],
  [[0, 0, -1], [1, 0, 0]],
];
// The cells a shape joins (RailState.updateConnections: a slope's high end one up).
const LINKS = [
  [[0, 0, -1], [0, 0, 1]],
  [[-1, 0, 0], [1, 0, 0]],
  [[-1, 0, 0], [1, 1, 0]],
  [[-1, 1, 0], [1, 0, 0]],
  [[0, 1, -1], [0, 0, 1]],
  [[0, 0, -1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, -1]],
  [[1, 0, 0], [0, 0, -1]],
];

// Kinds: 0 not a rail, 1 the rail, 2 powered, 3 detector, 4 activator.
export const RAIL_KIND = new Uint8Array(BLOCK_LIMIT);
export const RAIL_SHAPE = new Uint8Array(BLOCK_LIMIT);
export const RAIL_ON = new Uint8Array(BLOCK_LIMIT);
export const K_RAIL = 1;
export const K_POWERED = 2;
export const K_DETECTOR = 3;
export const K_ACTIVATOR = 4;
const BASES = [0, I.RAIL, I.POWERED_RAIL, I.DETECTOR_RAIL, I.ACTIVATOR_RAIL];
for (let s = 0; s < 10; s++) {
  RAIL_KIND[I.RAIL + s] = K_RAIL;
  RAIL_SHAPE[I.RAIL + s] = s;
}
for (const k of [K_POWERED, K_DETECTOR, K_ACTIVATOR]) {
  for (let v = 0; v < 12; v++) {
    RAIL_KIND[BASES[k] + v] = k;
    RAIL_SHAPE[BASES[k] + v] = v % 6;
    RAIL_ON[BASES[k] + v] = v >= 6 ? 1 : 0;
  }
}
export const isRail = (id) => RAIL_KIND[id] !== 0;
// The same kind of rail in another shape (power kept), and on or off.
export const railId = (kind, shape, on = 0) => BASES[kind] + shape + (kind !== K_RAIL && on ? 6 : 0);
export const withShape = (id, shape) => railId(RAIL_KIND[id], shape, RAIL_ON[id]);
export const withPower = (id, on) => railId(RAIL_KIND[id], RAIL_SHAPE[id], on ? 1 : 0);

// The redstone power reaching a cell (js/redstone-sim.js), 0 without one.
export function signalAt(x, y, z) {
  const sim = LIB.redstoneSim;
  if (!sim || typeof sim._input !== "function") return 0;
  if (typeof sim.powerAt === "function") return sim.powerAt(x, y, z);
  sim._lc = null; // (its chunk cache may be from another frame)
  return sim._input(x, y, z);
}

// Vanilla's RailState over `w` ({ get(x, y, z), set(x, y, z, id) }).
class RailState {
  constructor(w, x, y, z, id) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
    this.id = id;
    this.straight = RAIL_KIND[id] !== K_RAIL;
    this.links = [];
    this._links(RAIL_SHAPE[id]);
  }

  _links(shape) {
    this.links = LINKS[shape].map(([dx, dy, dz]) => [this.x + dx, this.y + dy, this.z + dz]);
  }

  // The rail at a cell, or one up, or one down (null: none).
  static at(w, x, y, z) {
    for (const dy of [0, 1, -1]) {
      const id = w.get(x, y + dy, z);
      if (isRail(id)) return new RailState(w, x, y + dy, z, id);
    }
    return null;
  }

  // Keeps only the links to rails that link back (each to where that rail is).
  _removeSoft() {
    for (let i = 0; i < this.links.length; i++) {
      const [x, y, z] = this.links[i];
      const r = RailState.at(this.w, x, y, z);
      if (r && r._linksTo(this)) this.links[i] = [r.x, r.y, r.z];
      else this.links.splice(i--, 1);
    }
  }

  _has(x, z) {
    return this.links.some((c) => c[0] === x && c[2] === z);
  }
  _linksTo(o) {
    return this._has(o.x, o.z);
  }
  _canLink(o) {
    return this._linksTo(o) || this.links.length !== 2;
  }
  _railNear(x, z) {
    const w = this.w;
    return isRail(w.get(x, this.y, z)) || isRail(w.get(x, this.y + 1, z)) || isRail(w.get(x, this.y - 1, z));
  }
  potential() {
    return (this._railNear(this.x, this.z - 1) ? 1 : 0) + (this._railNear(this.x, this.z + 1) ? 1 : 0) + (this._railNear(this.x - 1, this.z) ? 1 : 0) + (this._railNear(this.x + 1, this.z) ? 1 : 0);
  }
  _neighbour(x, z) {
    const r = RailState.at(this.w, x, this.y, z);
    if (!r) return false;
    r._removeSoft();
    return r._canLink(this);
  }
  _up(dx, dz) {
    return isRail(this.w.get(this.x + dx, this.y + 1, this.z + dz));
  }

  // Another rail joins this one: this one turns to it.
  _link(o) {
    this.links.push([o.x, o.y, o.z]);
    const n = this._has(this.x, this.z - 1);
    const s = this._has(this.x, this.z + 1);
    const wv = this._has(this.x - 1, this.z);
    const e = this._has(this.x + 1, this.z);
    let shape = -1;
    if (n || s) shape = NS;
    if (wv || e) shape = EW;
    if (!this.straight) {
      if (s && e && !n && !wv) shape = SE;
      if (s && wv && !n && !e) shape = SW;
      if (n && wv && !s && !e) shape = NW;
      if (n && e && !s && !wv) shape = NE;
    }
    shape = this._slope(shape);
    if (shape < 0) shape = NS;
    this.id = withShape(this.id, shape);
    this.w.set(this.x, this.y, this.z, this.id);
  }

  _slope(shape) {
    if (shape === NS) {
      if (this._up(0, -1)) shape = ASC_N;
      if (this._up(0, 1)) shape = ASC_S;
    } else if (shape === EW) {
      if (this._up(1, 0)) shape = ASC_E;
      if (this._up(-1, 0)) shape = ASC_W;
    }
    return shape;
  }

  // RailState.place: this rail's shape from the rails around it (powered:
  // the junction rule's other way round), set, and the rails it now links
  // to turn to it. Returns the id.
  place(powered, always, current) {
    const n = this._neighbour(this.x, this.z - 1);
    const s = this._neighbour(this.x, this.z + 1);
    const wv = this._neighbour(this.x - 1, this.z);
    const e = this._neighbour(this.x + 1, this.z);
    const ns = n || s;
    const ew = wv || e;
    let shape = -1;
    if (ns && !ew) shape = NS;
    if (ew && !ns) shape = EW;
    const se = s && e;
    const sw = s && wv;
    const ne = n && e;
    const nw = n && wv;
    if (!this.straight) {
      if (se && !n && !wv) shape = SE;
      if (sw && !n && !e) shape = SW;
      if (nw && !s && !e) shape = NW;
      if (ne && !s && !wv) shape = NE;
    }
    if (shape < 0) {
      if (ns && ew) shape = current;
      else if (ns) shape = NS;
      else if (ew) shape = EW;
      if (!this.straight) {
        if (powered) {
          if (se) shape = SE;
          if (sw) shape = SW;
          if (ne) shape = NE;
          if (nw) shape = NW;
        } else {
          if (nw) shape = NW;
          if (ne) shape = NE;
          if (sw) shape = SW;
          if (se) shape = SE;
        }
      }
    }
    shape = this._slope(shape);
    if (shape < 0) shape = current;
    this._links(shape);
    const id = withShape(this.id, shape);
    if (always || this.w.get(this.x, this.y, this.z) !== id) {
      this.id = id;
      this.w.set(this.x, this.y, this.z, id);
      for (const [x, y, z] of this.links.slice()) {
        const r = RailState.at(this.w, x, y, z);
        if (!r) continue;
        r._removeSoft();
        if (r._canLink(this)) r._link(this);
      }
    }
    return this.id;
  }
}

// An overlay on a world: reads see what was set, the changes are listed.
export function railOverlay(world) {
  const changes = new Map();
  const k = (x, y, z) => `${x},${y},${z}`;
  return {
    changes,
    get: (x, y, z) => {
      const c = changes.get(k(x, y, z));
      return c ? c[3] : world.getBlock(x, y, z);
    },
    set: (x, y, z, id) => changes.set(k(x, y, z), [x, y, z, id]),
    // (the changes as a world edit list, the cells whose block changed)
    list() {
      const out = [];
      for (const [x, y, z, id] of changes.values()) if (world.getBlock(x, y, z) !== id) out.push(x, y, z, id);
      return out;
    },
  };
}

// The rail at (x, y, z) placed as vanilla's (RailState.place on the
// overlay `w`): its own shape and its neighbours' turns. Returns its id.
export function railPlace(w, x, y, z, id, powered = false, always = true) {
  return new RailState(w, x, y, z, id).place(powered, always, RAIL_SHAPE[id]);
}

// How many rails are around a rail (a junction has 3).
export function railPotential(w, x, y, z, id) {
  return new RailState(w, x, y, z, id).potential();
}

// What the cart's exits of a rail are (EXITS) and the shapes' kinds, for js/minecarts.js.
export const exitsOf = (id) => EXITS[RAIL_SHAPE[id]];

// ---------- Blocks ----------

const S = 1 / 16;
const RY = S; // (the rail's height over its floor)
// A rail stands on a block with a whole top (vanilla's sturdy face: glass
// too, a top slab, upside-down stairs; not a bottom slab, a fence, leaves).
export function sturdyTop(id) {
  const info = LIB.BLOCK_INFO?.[id];
  if (!info || !info.solid || info.leaves) return false;
  if (!info.collision) return info.shape === 0 || info.opaque;
  return info.collision.some((b) => b[0] <= 0 && b[2] <= 0 && b[3] >= 1 && b[5] >= 1 && b[4] >= 1 && b[1] < 1);
}

// The texture turned k quarter turns clockwise (seen from above, north up)
// at the cell's corner (x, z): the tile's (u, v).
function uvAt(x, z, k) {
  let tx = x;
  let ty = z;
  for (let i = 0; i < k; i++) [tx, ty] = [ty, 1 - tx];
  return [tx, 1 - ty];
}
// Each shape's quad: corners (counter-clockwise from above) and uvs.
// (A curve's tile joins south and east; a straight tile runs north-south.)
const QUADS = [];
{
  const ROT = [0, 1, 1, 1, 0, 0, 0, 1, 2, 3];
  for (let s = 0; s < 10; s++) {
    const h = (x, z) => {
      if (s === ASC_E) return RY + x;
      if (s === ASC_W) return RY + 1 - x;
      if (s === ASC_N) return RY + 1 - z;
      if (s === ASC_S) return RY + z;
      return RY;
    };
    const xz = [[0, 1], [1, 1], [1, 0], [0, 0]];
    QUADS.push({ corners: xz.map(([x, z]) => [x, h(x, z), z]), uvs: xz.map(([x, z]) => uvAt(x, z, ROT[s])) });
  }
}
// (and the underside of a slope, seen from below and from its low side)
const UNDER = QUADS.map((q, s) => (isAscending(s) ? { corners: [...q.corners].reverse(), uvs: [...q.uvs].reverse() } : null));

export const shapes = {
  tr_rail: {
    mesh(m) {
      const s = RAIL_SHAPE[m.id];
      const q = QUADS[s];
      const t = m.tile(FACE.PY);
      m.quad(q.corners, q.uvs, FACE.PY, t);
      if (UNDER[s]) m.quad(UNDER[s].corners, UNDER[s].uvs, FACE.PY, t);
    },
  },
};

export const blocks = {};
export const itemUse = {};

const RAIL_NAMES = ["", "Rail", "Powered Rail", "Detector Rail", "Activator Rail"];
const RAIL_TILES = ["", "rail", "powered_rail", "detector_rail", "activator_rail"];
// A rail put down: straight along the view, then as vanilla's rule makes it.
const placeRail = (kind) => (ctx) => {
  if (!ctx.place) return null;
  const [x, y, z] = ctx.place;
  const f = ctx.forward || [0, 0, -1];
  const first = railId(kind, Math.abs(f[0]) > Math.abs(f[2]) ? EW : NS);
  const w = railOverlay(ctx.world);
  w.set(x, y, z, first);
  // (the shape it settles into; js/minecarts.js turns the neighbours once it is in)
  return railPlace(w, x, y, z, first, signalAt(x, y, z) > 0, true);
};
for (const kind of [K_RAIL, K_POWERED, K_DETECTOR, K_ACTIVATOR]) {
  const n = kind === K_RAIL ? 10 : 12;
  for (let v = 0; v < n; v++) {
    const id = BASES[kind] + v;
    const shape = RAIL_SHAPE[id];
    const on = RAIL_ON[id];
    const curve = shape >= SE;
    blocks[id] = {
      name: RAIL_NAMES[kind],
      faces: curve ? "rail_corner" : on ? `${RAIL_TILES[kind]}_on` : RAIL_TILES[kind],
      shape: "tr_rail",
      render: RENDER.CUTOUT,
      solid: false,
      opaque: false,
      skyPass: true,
      box: isAscending(shape) ? [0, 0, 0, 1, 0.5, 1] : [0, 0, 0, 1, 2 * S, 1],
      support: (below) => sturdyTop(below),
      hardness: 0.7,
      tool: "pickaxe",
      sound: "stone",
      rail: kind,
      // (the redstone's kinds: a detector rail with a cart on it is a source, js/minecarts.js)
      ...(v ? { item: BASES[kind], creative: false } : { placeAs: placeRail(kind) }),
    };
  }
}

// ---------- Items ----------

export const WOODS = [
  { key: "oak", name: "Oak", planks: BLOCK.PLANKS, tile: "planks", ramp: [0x4a3018, 0x6b4726, 0x8c6035, 0xae7c47, 0xc99a5e] },
  { key: "spruce", name: "Spruce", planks: I.SPRUCE_PLANKS, tile: "spruce_planks", ramp: [0x2e1e10, 0x45301c, 0x5d412a, 0x725233, 0x8c6741] },
  { key: "birch", name: "Birch", planks: I.BIRCH_PLANKS, tile: "birch_planks", ramp: [0x7d6c40, 0xa69460, 0xbfad74, 0xd2c084, 0xe8dba4] },
  { key: "jungle", name: "Jungle", planks: I.JUNGLE_PLANKS, tile: "jungle_planks", ramp: [0x4f3220, 0x6e482e, 0x8e603a, 0xa87448, 0xc28d60] },
  { key: "acacia", name: "Acacia", planks: I.ACACIA_PLANKS, tile: "acacia_planks", ramp: [0x6a2c12, 0x8e3f1e, 0xb5552c, 0xc96a3c, 0xe08a5a] },
  { key: "dark_oak", name: "Dark Oak", planks: I.DARK_OAK_PLANKS, tile: "dark_oak_planks", ramp: [0x1e1006, 0x2e1c0c, 0x442c16, 0x56381e, 0x70502e] },
];
export const isBoat = (id) => id >= I.OAK_BOAT && id < I.OAK_BOAT + 12;
// A boat item's wood (0-5) and whether it carries a chest.
export const boatWood = (id) => (id - I.OAK_BOAT) % 6;
export const boatChest = (id) => id >= I.OAK_CHEST_BOAT;
export const boatItem = (wood, chest) => (chest ? I.OAK_CHEST_BOAT : I.OAK_BOAT) + wood;
export const cartItem = (chest) => (chest ? I.CHEST_MINECART : I.MINECART);

export const items = {};
WOODS.forEach((w, i) => {
  items[I.OAK_BOAT + i] = { name: `${w.name} Boat`, icon: `boat_${w.key}`, stack: 1 };
  items[I.OAK_CHEST_BOAT + i] = { name: `${w.name} Boat with Chest`, icon: `chest_boat_${w.key}`, stack: 1 };
});
items[I.MINECART] = { name: "Minecart", icon: "minecart", stack: 1 };
items[I.CHEST_MINECART] = { name: "Minecart with Chest", icon: "chest_minecart", stack: 1 };

// Placing them is the vehicles' (js/boats.js sets LIB.transport): a boat on
// the water (or the ground) aimed at, a minecart on the rail aimed at.
for (let i = 0; i < 12; i++) itemUse[I.OAK_BOAT + i] = (ctx) => !!LIB.transport?.placeBoat?.(ctx, i % 6, i >= 6);
itemUse[I.MINECART] = (ctx) => !!LIB.transport?.placeCart?.(ctx, false);
itemUse[I.CHEST_MINECART] = (ctx) => !!LIB.transport?.placeCart?.(ctx, true);

// ---------- Recipes (vanilla's) ----------

export const recipes = () => {
  const out = [];
  const shaped = (pattern, key, id, n) => out.push({ type: "shaped", pattern, key, result: [id, n] });
  WOODS.forEach((w, i) => {
    shaped(["# #", "###"], { "#": w.planks }, I.OAK_BOAT + i, 1);
    out.push({ type: "shapeless", ingredients: [I.OAK_BOAT + i, BLOCK.CHEST], result: [I.OAK_CHEST_BOAT + i, 1] });
    out.push({ type: "fuel", input: I.OAK_BOAT + i, time: 60 }); // (1200 ticks)
  });
  shaped(["# #", "###"], { "#": I.IRON_INGOT }, I.MINECART, 1);
  out.push({ type: "shapeless", ingredients: [I.MINECART, BLOCK.CHEST], result: [I.CHEST_MINECART, 1] });
  shaped(["# #", "#S#", "# #"], { "#": I.IRON_INGOT, S: ITEM.STICK }, I.RAIL, 16);
  shaped(["# #", "#S#", "#R#"], { "#": ITEM.GOLD_INGOT, S: ITEM.STICK, R: I.REDSTONE }, I.POWERED_RAIL, 6);
  shaped(["# #", "#P#", "#R#"], { "#": I.IRON_INGOT, P: I.STONE_PRESSURE_PLATE, R: I.REDSTONE }, I.DETECTOR_RAIL, 6);
  shaped(["#S#", "#T#", "#S#"], { "#": I.IRON_INGOT, S: ITEM.STICK, T: I.REDSTONE_TORCH }, I.ACTIVATOR_RAIL, 6);
  return out;
};

// ---------- Tiles ----------

export const tiles = {};
export const tileRelief = {};
const CLEAR = [0, 0, 0];
const pal = (kit, list) => list.map(kit.hex);
const IRON = [0x3c3f44, 0x5d6168, 0x868b92, 0xb0b5bb, 0xd8dce0];
const GOLD = [0x6e4a08, 0x9c6e10, 0xd09c22, 0xf0c640, 0xfff09a];
const TIE = [0x3a2512, 0x4f3319, 0x664322, 0x7a532c];
const STONE = [0x45454b, 0x5c5c63, 0x76767d, 0x8e8e95];
const RED_OFF = [0x3a0606, 0x520a0a, 0x6a1010];
const RED_ON = [0xa01010, 0xe0281c, 0xff6a4a];

// The sleepers (4 across the tile) and the two rails along it (x 6-8, 23-25).
function sleepers(t, kit, ramp) {
  const tie = pal(kit, ramp);
  for (const y0 of [2, 10, 18, 26]) {
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 3; x < 29; x++) {
        const edge = y === y0 || x === 3 || x === 28;
        t.set(x, y, kit.ramp(tie, (y === y0 + 3 || x === 28 ? 0.1 : edge ? 0.85 : 0.5) + (t.rand() - 0.5) * 0.25));
      }
    }
  }
}
function rails(t, kit, ramp) {
  const r = pal(kit, ramp);
  for (let y = 0; y < 32; y++) {
    for (const x0 of [6, 23]) {
      t.set(x0, y, r[3]);
      t.set(x0 + 1, y, r[4]);
      t.set(x0 + 2, y, r[1]);
      if (y % 8 === 1) t.set(x0 + 1, y, r[2]); // (the joints between lengths)
    }
  }
}
tiles.rail = (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  sleepers(t, kit, TIE);
  rails(t, kit, IRON);
};
// The curve: rails round the south-east corner (radii 8 and 25 from it), sleepers across them.
tiles.rail_corner = (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  const tie = pal(kit, TIE);
  const r = pal(kit, IRON);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(32 - (x + 0.5), 32 - (y + 0.5));
      const a = Math.atan2(32 - (y + 0.5), 32 - (x + 0.5)); // (0 along the south edge, pi/2 along the east)
      const seg = (a / (Math.PI / 2)) * 4;
      const inTie = seg - Math.floor(seg) > 0.15 && seg - Math.floor(seg) < 0.62 && d > 4.5 && d < 28.5;
      if (inTie) t.set(x, y, kit.ramp(tie, 0.5 + (t.rand() - 0.5) * 0.3));
      for (const R of [7.5, 24.5]) {
        const k = d - R;
        if (k > -1.6 && k < 1.6) t.set(x, y, k < -0.55 ? r[3] : k < 0.55 ? r[4] : r[1]);
      }
    }
  }
};
// The powered rail: gold rails, a redstone line between them (dull off, bright on).
const poweredTile = (on) => (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  sleepers(t, kit, TIE);
  const red = pal(kit, on ? RED_ON : RED_OFF);
  for (let y = 0; y < 32; y++) for (let x = 14; x < 18; x++) t.set(x, y, red[x === 14 || x === 17 ? 0 : on && y % 4 === 0 ? 2 : 1]);
  rails(t, kit, GOLD);
};
tiles.powered_rail = poweredTile(false);
tiles.powered_rail_on = poweredTile(true);
// The detector rail: a pressure plate between iron rails, its redstone lit with a cart on it.
const detectorTile = (on) => (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  sleepers(t, kit, TIE);
  const plate = pal(kit, STONE);
  const red = pal(kit, on ? RED_ON : RED_OFF);
  for (let y = 6; y < 26; y++) {
    for (let x = 10; x < 22; x++) {
      const edge = x === 10 || y === 6;
      const shade = x === 21 || y === 25;
      t.set(x, y, plate[edge ? 3 : shade ? 0 : 2]);
    }
  }
  for (let y = 12; y < 20; y++) for (let x = 13; x < 19; x++) t.set(x, y, red[Math.abs(x - 15.5) + Math.abs(y - 15.5) < 3 ? 2 : 1]);
  rails(t, kit, IRON);
};
tiles.detector_rail = detectorTile(false);
tiles.detector_rail_on = detectorTile(true);
// The activator rail: stone sleepers, iron rails, a redstone strip across each sleeper.
const activatorTile = (on) => (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  sleepers(t, kit, [0x3a3a40, 0x505057, 0x66666e, 0x7a7a82]);
  const red = pal(kit, on ? RED_ON : RED_OFF);
  for (const y0 of [2, 10, 18, 26]) for (let x = 9; x < 23; x++) for (let y = y0 + 1; y < y0 + 3; y++) t.set(x, y, red[on && (x + y) % 3 === 0 ? 2 : 1]);
  rails(t, kit, IRON);
};
tiles.activator_rail = activatorTile(false);
tiles.activator_rail_on = activatorTile(true);
// The minecart's iron: plates with a darker rim and rivets (js/minecarts.js's model).
tiles.minecart = (t, kit) => {
  const iron = pal(kit, [0x2c2f34, 0x3e4248, 0x51565d, 0x646a72, 0x7a8089]);
  t.forEach((x, y) => {
    const e = Math.min(x, y, 31 - x, 31 - y);
    let k = 0.55 + (t.fbm(x, y, 8, 2) - 0.5) * 0.25 + (t.rand() - 0.5) * 0.08;
    if (e < 2) k = e === 0 ? 0.1 : 0.85;
    if (e === 3 && (x % 6 === 3 || y % 6 === 3)) k = 0.95; // (rivets along the rim)
    t.set(x, y, kit.ramp(iron, k));
  });
};
tileRelief.rail = [1.0, 0.5, 1];
tileRelief.rail_corner = [1.0, 0.5, 1];
tileRelief.minecart = [1.2, 0.45, 1];

// ---------- Icons ----------

export const icons = {};
// A boat seen from the side, bow to the right, an oar over it; a chest boat has its chest aboard.
function boatIcon(kit, wood, chest) {
  const c = new kit.Canvas();
  const HULL = 0;
  const DARK = 1;
  const OAR = 2;
  const CHEST = 3;
  const LATCH = 4;
  c.line(OAR, 6, 9, 21, 22, 2.2, () => 0.2);
  c.poly(OAR, [[4, 7], [8, 6.5], [9, 10], [5, 11]], () => 0.35);
  if (chest) {
    c.poly(CHEST, [[12, 9], [22, 9], [22, 18], [12, 18]], (x, y) => (y < 11 ? 0.5 : x < 15 ? 0.25 : -0.1));
    c.poly(LATCH, [[16, 11], [18, 11], [18, 14], [16, 14]], () => 0.4);
  }
  c.poly(HULL, [[2, 16], [30, 15], [26, 25], [7, 26]], (x, y) => (y < 19 ? 0.45 : y > 23 ? -0.35 : 0.05));
  c.poly(DARK, [[4, 16.5], [28, 15.5], [27.5, 17.5], [4.5, 18.2]], () => -0.6); // (the gunwale's inner shade)
  for (const x of [11, 19]) c.line(DARK, x, 19, x - 0.6, 25, 1, () => -0.2); // (the planks' joints)
  const w = kit.ramp(...wood.ramp);
  return c.render([w, w, kit.ramp(...wood.ramp), kit.ramp(0x4a2a10, 0x6e4218, 0x9a6224, 0xbe8a3e, 0xd8ac62), kit.RAMPS.iron], [22, 14, 8]);
}
WOODS.forEach((w) => {
  icons[`boat_${w.key}`] = (kit) => boatIcon(kit, w, false);
  icons[`chest_boat_${w.key}`] = (kit) => boatIcon(kit, w, true);
});
// A minecart from the side: an open iron tub on two wheels; with a chest in it.
function cartIcon(kit, chest) {
  const c = new kit.Canvas();
  const IRONM = 0;
  const DARK = 1;
  const WHEEL = 2;
  const CHEST = 3;
  const LATCH = 4;
  if (chest) {
    c.poly(CHEST, [[9, 5], [23, 5], [23, 15], [9, 15]], (x, y) => (y < 8 ? 0.5 : x < 13 ? 0.25 : -0.1));
    c.poly(LATCH, [[15, 8], [17, 8], [17, 11], [15, 11]], () => 0.4);
  }
  c.poly(IRONM, [[3, 12], [29, 12], [26, 25], [6, 25]], (x, y) => (y < 15 ? 0.5 : y > 22 ? -0.35 : 0.05));
  c.poly(DARK, [[5, 12.5], [27, 12.5], [26.5, 14.6], [5.5, 14.6]], () => -0.7);
  c.line(DARK, 6.5, 19, 25.5, 19, 1, () => -0.15);
  for (const x of [10, 22]) {
    c.disc(WHEEL, x, 26, 3.4, 3.4, () => -0.2);
    c.disc(DARK, x, 26, 1.2, 1.2, () => 0.3);
  }
  const iron = kit.ramp(0x2c2f34, 0x484d54, 0x666c74, 0x8a9098, 0xb4bac2);
  return c.render([iron, iron, kit.ramp(0x101012, 0x1c1c20, 0x2a2a30, 0x3c3c44, 0x50505a), kit.ramp(0x4a2a10, 0x6e4218, 0x9a6224, 0xbe8a3e, 0xd8ac62), kit.RAMPS.iron], [14, 15, 18]);
}
icons.minecart = (kit) => cartIcon(kit, false);
icons.chest_minecart = (kit) => cartIcon(kit, true);
