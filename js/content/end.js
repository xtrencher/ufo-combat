// The End (Round 12): end stone and its bricks, purpur, end rods, chorus
// plants and their fruit, the dragon egg and head, the end portal's frame
// and its portal, the end gateway, the strongholds' silverfish spawner, and
// the End's items (the eye of ender, dragon's breath, the shulker shell, the
// elytra, the end crystal).
// Ids: blocks 2560-2815, items 864-959 (ids.js). What a content module may
// export, and its rules: see ./index.js.
//
// Vanilla (Java 1.20) in values and recipes: hardness, tools, light, blast
// resistance, the chorus flower's growth (ChorusFlowerBlock.randomTick) and
// its plant's survival rule (chorusSurvives: the cascade when a plant loses
// its hold is js/dragon.js's, which watches the edits), the portal's check
// (all twelve frames turned toward the 3 x 3 inside it, each with an eye).
// The uses that need the engine go through LIB hooks set by js/dragon.js:
// LIB.throwEnderEye(ctx) (an eye thrown toward the nearest stronghold),
// LIB.placeEndCrystal(ctx) (a crystal set on obsidian or bedrock),
// LIB.onEndPortal(cells) (a portal lit). Where the engine sets a limit: the
// end portal and the gateway are drawn by js/dragon.js (their starfield,
// vanilla's screen-space look), not by the mesher; the egg is pushed by a
// punch through js/dragon.js too (interaction's mining has no other hook);
// the stairs, slabs and walls are building.js's (addFamily), so they join,
// mesh and collide as its own do (until building.js has it: none of them).
import { BLOCK, RENDER, FACE, LIB } from "./base.js";
import * as I from "./ids.js";
import * as B from "./building.js";

const S = 1 / 16;
// Facings (ids.js): 0 +Z, 1 -Z, 2 +X, 3 -X.
const FX = [0, 0, 1, -1];
const FZ = [1, -1, 0, 0];
const OPP = [1, 0, 3, 2];
// The FACE a facing points through, and the one a FACE is opposite to.
const DIR_FACE = [FACE.PZ, FACE.NZ, FACE.PX, FACE.NX];
const FACE_OPP = [FACE.NX, FACE.PX, FACE.NY, FACE.PY, FACE.NZ, FACE.PZ];
// FACE order: +X, -X, +Y, -Y, +Z, -Z, as [dx, dy, dz].
const FACE_DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const bit = (face) => 1 << face;

function facingOf(dx, dz) {
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 2 : 3) : dz >= 0 ? 0 : 1;
}
const look = (ctx) => facingOf(ctx.forward[0], ctx.forward[2]);
// (the face of the clicked block the new one goes against, as a FACE: from the hit's normal)
function clickedFace(ctx) {
  const n = ctx.normal;
  if (!n) return FACE.PY;
  for (let f = 0; f < 6; f++) if (FACE_DIR[f][0] === n[0] && FACE_DIR[f][1] === n[1] && FACE_DIR[f][2] === n[2]) return f;
  return FACE.PY;
}

// ---------- What each id is ----------

export const isFrame = (id) => id >= I.END_PORTAL_FRAME && id < I.END_PORTAL_FRAME + 8;
export const frameFacing = (id) => (id - I.END_PORTAL_FRAME) & 3;
export const frameHasEye = (id) => id - I.END_PORTAL_FRAME >= 4;
export const isChorusFlower = (id) => id >= I.CHORUS_FLOWER && id < I.CHORUS_FLOWER + 6;
export const isChorus = (id) => id === I.CHORUS_PLANT || isChorusFlower(id);
export const isEndRod = (id) => id >= I.END_ROD && id < I.END_ROD + 6;
export const isPurpurPillar = (id) => id >= I.PURPUR_PILLAR && id < I.PURPUR_PILLAR + 3;
// The frame turned toward facing f, with an eye or not.
export const frameId = (f, eye = false) => I.END_PORTAL_FRAME + f + (eye ? 4 : 0);

// ---------- Defs ----------

export const blocks = {};
export const items = {};
export const blockUse = {};
export const itemUse = {};
export const randomTick = {};
export const drops = {};
const none = () => [];

const PICK = { tool: "pickaxe", minTier: 1, sound: "stone" };
const END_STONE_MAT = { hardness: 3, blastResistance: 9 };
const PURPUR_MAT = { hardness: 1.5, blastResistance: 6 };
// (blast resistance 3,600,000: as bedrock, nothing blows them away)
const UNBREAKABLE = { hardness: -1, blastResistance: 3600000 };

blocks[I.END_STONE] = { name: "End Stone", faces: "end_stone", ...PICK, ...END_STONE_MAT };
blocks[I.END_STONE_BRICKS] = { name: "End Stone Bricks", faces: "end_stone_bricks", ...PICK, ...END_STONE_MAT };
blocks[I.PURPUR_BLOCK] = { name: "Purpur Block", faces: "purpur_block", ...PICK, ...PURPUR_MAT };

// Purpur pillars: along y, x or z (the axis of the face it was put against).
// The fluting runs along the axis: "purpur_pillar" upright, "purpur_pillar_rot" across.
const PILLAR_FACES = [
  { top: "purpur_pillar_top", bottom: "purpur_pillar_top", side: "purpur_pillar" },
  { top: "purpur_pillar_rot", bottom: "purpur_pillar_rot", side: "purpur_pillar_top", front: "purpur_pillar_rot" },
  { top: "purpur_pillar", bottom: "purpur_pillar", side: "purpur_pillar_rot", front: "purpur_pillar_top" },
];
for (let a = 0; a < 3; a++) {
  blocks[I.PURPUR_PILLAR + a] = {
    name: "Purpur Pillar",
    faces: PILLAR_FACES[a],
    ...PICK,
    ...PURPUR_MAT,
    ...(a ? { item: I.PURPUR_PILLAR } : { placeAs: (ctx) => I.PURPUR_PILLAR + [1, 1, 0, 0, 2, 2][clickedFace(ctx)] }),
  };
}

// Stairs, slabs and the wall (building.js's addFamily makes them, so they
// behave as its own; a slab is 2 hardness as every slab there; full: the
// block a double slab is).
export const FAMILIES = [
  { name: "End Stone Brick", faces: "end_stone_bricks", full: I.END_STONE_BRICKS, mat: { ...PICK, ...END_STONE_MAT }, stairs: I.END_STONE_BRICK_STAIRS, slab: I.END_STONE_BRICK_SLAB, wall: I.END_STONE_BRICK_WALL },
  { name: "Purpur", faces: "purpur_block", full: I.PURPUR_BLOCK, mat: { ...PICK, ...PURPUR_MAT }, stairs: I.PURPUR_STAIRS, slab: I.PURPUR_SLAB },
];
// (Whether building.js can make them: until it exports addFamily, there are none.)
export const HAS_FAMILIES = typeof B.addFamily === "function";
if (HAS_FAMILIES) for (const fam of FAMILIES) B.addFamily(blocks, fam);

// End rods: a glowing rod pointing away from the face it was put against.
const ROD_BOXES = []; // FACE -> [rod, base]
for (let f = 0; f < 6; f++) {
  const axis = f >> 1;
  const neg = f & 1;
  const rod = [7 * S, 7 * S, 7 * S, 9 * S, 9 * S, 9 * S];
  const base = [6 * S, 6 * S, 6 * S, 10 * S, 10 * S, 10 * S];
  // (along its axis: the rod from 1/16 to the far end, the base the first 1/16)
  rod[axis] = neg ? 0 : S;
  rod[axis + 3] = neg ? 15 * S : 1;
  base[axis] = neg ? 15 * S : 0;
  base[axis + 3] = neg ? 1 : S;
  ROD_BOXES.push([rod, base]);
}
for (let f = 0; f < 6; f++) {
  const [rod, base] = ROD_BOXES[f];
  const box = [Math.min(rod[0], base[0]), Math.min(rod[1], base[1]), Math.min(rod[2], base[2]), Math.max(rod[3], base[3]), Math.max(rod[4], base[4]), Math.max(rod[5], base[5])];
  blocks[I.END_ROD + f] = {
    name: "End Rod",
    faces: "end_rod",
    render: RENDER.CUTOUT,
    shape: "end_rod",
    opaque: false,
    skyPass: true,
    emission: 14,
    emissive: true,
    box,
    collision: [box],
    hardness: 0,
    sound: "wood",
    ...(f !== FACE.PY ? { item: I.END_ROD + FACE.PY } : { placeAs: (ctx) => I.END_ROD + clickedFace(ctx), itemBoxes: [ROD_BOXES[FACE.PY][0], ROD_BOXES[FACE.PY][1]] }),
  };
}

// Chorus plants: a stem joined to the chorus around it and to end stone
// below; they live on as long as they hold (chorusSurvives). Flowers grow
// them (randomTick); a broken one drops chorus fruit half the time.
const CHORUS_CORE = [4 * S, 4 * S, 4 * S, 12 * S, 12 * S, 12 * S];
const CHORUS_ARM = FACE_DIR.map(([dx, dy, dz]) => {
  const b = CHORUS_CORE.slice();
  for (let a = 0; a < 3; a++) {
    const d = [dx, dy, dz][a];
    if (d > 0) [b[a], b[a + 3]] = [12 * S, 1];
    else if (d < 0) [b[a], b[a + 3]] = [0, 4 * S];
  }
  return b;
});
// (the arms a plant shows: toward chorus, and down toward end stone)
function chorusMask(get) {
  let mask = 0;
  for (let f = 0; f < 6; f++) {
    const [dx, dy, dz] = FACE_DIR[f];
    const n = get(dx, dy, dz);
    if (isChorus(n) || (f === FACE.NY && n === I.END_STONE)) mask |= bit(f);
  }
  return mask;
}
const CHORUS_BOXES = [];
for (let mask = 0; mask < 64; mask++) {
  const list = [CHORUS_CORE];
  for (let f = 0; f < 6; f++) if (mask & bit(f)) list.push(CHORUS_ARM[f]);
  CHORUS_BOXES.push(list);
}
blocks[I.CHORUS_PLANT] = {
  name: "Chorus Plant",
  faces: "chorus_plant",
  shape: "chorus_plant",
  opaque: false,
  box: [0, 0, 0, 1, 1, 1],
  collision: [CHORUS_CORE],
  collide: (world, x, y, z) => CHORUS_BOXES[chorusMask((dx, dy, dz) => world.getBlock(x + dx, y + dy, z + dz))],
  hardness: 0.4,
  tool: "axe",
  sound: "wood",
  itemBoxes: [CHORUS_CORE, CHORUS_ARM[FACE.PY], CHORUS_ARM[FACE.NY], CHORUS_ARM[FACE.PX]],
};
drops[I.CHORUS_PLANT] = (tool, rand) => (rand() < 0.5 ? [[I.CHORUS_FRUIT, 1]] : []);
for (let age = 0; age < 6; age++) {
  blocks[I.CHORUS_FLOWER + age] = {
    name: "Chorus Flower",
    faces: age === 5 ? "chorus_flower_dead" : "chorus_flower",
    render: RENDER.CUTOUT,
    opaque: false,
    hardness: 0.4,
    tool: "axe",
    sound: "wood",
    // (vanilla's canSurvive, chorusSurvives: on a plant or end stone, or over
    // air beside one plant, as one grown sideways; the air case is left to the
    // cascade, js/dragon.js, which knows what is beside it)
    support: (below) => below === I.CHORUS_PLANT || below === I.END_STONE || below === BLOCK.AIR,
    ...(age ? { item: I.CHORUS_FLOWER } : { placeAs: placeChorusFlower }),
  };
  drops[I.CHORUS_FLOWER + age] = () => [[I.CHORUS_FLOWER, 1]];
}

// A flower put down only where it would hold (chorusSurvives, with it there).
function placeChorusFlower(ctx) {
  const [px, py, pz] = ctx.place || [];
  if (px === undefined) return null;
  const get = (x, y, z) => (x === px && y === py && z === pz ? I.CHORUS_FLOWER : ctx.world.getBlock(x, y, z));
  return chorusSurvives(get, px, py, pz) ? I.CHORUS_FLOWER : null;
}

// Vanilla's ChorusPlantBlock.canSurvive: end stone or a plant below, or a
// plant beside it that stands on one (and nothing both above and below).
// get(x, y, z): the block there.
export function chorusSurvives(get, x, y, z) {
  const id = get(x, y, z);
  const below = get(x, y - 1, z);
  if (isChorusFlower(id)) {
    if (below === I.CHORUS_PLANT || below === I.END_STONE) return true;
    if (below !== BLOCK.AIR) return false;
    let found = false;
    for (let d = 0; d < 4; d++) {
      const n = get(x + FX[d], y, z + FZ[d]);
      if (n === I.CHORUS_PLANT) {
        if (found) return false;
        found = true;
      } else if (n !== BLOCK.AIR) return false;
    }
    return found;
  }
  if (id !== I.CHORUS_PLANT) return true;
  const closed = get(x, y + 1, z) !== BLOCK.AIR && below !== BLOCK.AIR;
  for (let d = 0; d < 4; d++) {
    if (get(x + FX[d], y, z + FZ[d]) !== I.CHORUS_PLANT) continue;
    if (closed) return false;
    const b = get(x + FX[d], y - 1, z + FZ[d]);
    if (b === I.CHORUS_PLANT || b === I.END_STONE) return true;
  }
  return below === I.CHORUS_PLANT || below === I.END_STONE;
}

// Vanilla's ChorusFlowerBlock.randomTick: up while the stem below is short
// (and over end stone), else out to the sides, else it dies (age 5).
function emptyAround(world, x, y, z, except) {
  for (let d = 0; d < 4; d++) if (d !== except && world.getBlock(x + FX[d], y, z + FZ[d]) !== BLOCK.AIR) return false;
  return true;
}
function chorusGrow(world, x, y, z, id, rand) {
  const age = id - I.CHORUS_FLOWER;
  if (age >= 5 || y + 2 >= 128 || world.getBlock(x, y + 1, z) !== BLOCK.AIR) return;
  const below = world.getBlock(x, y - 1, z);
  let up = false;
  let endStone = false;
  if (below === I.END_STONE) up = true;
  else if (below === I.CHORUS_PLANT) {
    let n = 1;
    for (let i = 0; i < 4; i++) {
      const b = world.getBlock(x, y - n - 1, z);
      if (b === I.CHORUS_PLANT) n++;
      else {
        if (b === I.END_STONE) endStone = true;
        break;
      }
    }
    if (n < 2 || n <= Math.floor(rand() * (endStone ? 5 : 4))) up = true;
  } else if (below === BLOCK.AIR) up = true;
  if (up && emptyAround(world, x, y + 1, z, -1) && world.getBlock(x, y + 2, z) === BLOCK.AIR) {
    world.setBlocks([x, y, z, I.CHORUS_PLANT, x, y + 1, z, id]);
    return;
  }
  if (age < 4) {
    const tries = Math.floor(rand() * 4) + (endStone ? 1 : 0);
    const list = [];
    for (let i = 0; i < tries; i++) {
      const d = Math.floor(rand() * 4);
      const nx = x + FX[d];
      const nz = z + FZ[d];
      if (world.getBlock(nx, y, nz) === BLOCK.AIR && world.getBlock(nx, y - 1, nz) === BLOCK.AIR && emptyAround(world, nx, y, nz, OPP[d])) list.push(nx, y, nz, I.CHORUS_FLOWER + age + 1);
    }
    list.push(x, y, z, list.length ? I.CHORUS_PLANT : I.CHORUS_FLOWER + 5);
    world.setBlocks(list);
    return;
  }
  world.setBlock(x, y, z, I.CHORUS_FLOWER + 5);
}
for (let age = 0; age < 5; age++) randomTick[I.CHORUS_FLOWER + age] = chorusGrow;

// The dragon egg: falls like sand, and teleports away when it is touched
// (a right click here; a punch through js/dragon.js); light 1.
const EGG_LAYERS = [[3, 0, 1], [2, 1, 3], [1, 3, 8], [2, 8, 11], [3, 11, 13], [4, 13, 14], [5, 14, 15], [6, 15, 16]];
const EGG_BOXES = EGG_LAYERS.map(([i, y0, y1]) => [i * S, y0 * S, i * S, (16 - i) * S, y1 * S, (16 - i) * S]);
blocks[I.DRAGON_EGG] = {
  name: "Dragon Egg",
  faces: "dragon_egg",
  shape: "dragon_egg",
  opaque: false,
  gravity: true,
  emission: 1,
  box: [S, 0, S, 15 * S, 1, 15 * S],
  collision: [[S, 0, S, 15 * S, 1, 15 * S]],
  hardness: 3,
  blastResistance: 9,
  sound: "stone",
  itemBoxes: EGG_BOXES,
};
// Vanilla's DragonEggBlock.teleport: a free cell within 15 across and 7 up
// or down, 1000 tries; the egg moves there (an edit, for everyone).
export function teleportEgg(world, x, y, z, rand = Math.random) {
  if (world.getBlock(x, y, z) !== I.DRAGON_EGG) return null;
  for (let i = 0; i < 1000; i++) {
    const nx = x + Math.floor(rand() * 16) - Math.floor(rand() * 16);
    const ny = y + Math.floor(rand() * 8) - Math.floor(rand() * 8);
    const nz = z + Math.floor(rand() * 16) - Math.floor(rand() * 16);
    if (ny < 1 || ny > 126 || world.getBlock(nx, ny, nz) !== BLOCK.AIR) continue;
    if (!world.getChunk?.(nx >> 4, nz >> 4)) continue;
    world.setBlocks([x, y, z, BLOCK.AIR, nx, ny, nz, I.DRAGON_EGG]);
    return [nx, ny, nz];
  }
  return null;
}
blockUse[I.DRAGON_EGG] = (ctx) => {
  const to = teleportEgg(ctx.world, ctx.x, ctx.y, ctx.z);
  if (to) LIB.onEggTeleport?.([ctx.x, ctx.y, ctx.z], to);
  return true;
};

// The dragon head (the end ships' bows): a block-sized head, turned toward
// whoever put it down.
const HEAD_BOX = [3 * S, 0, 3 * S, 13 * S, 10 * S, 13 * S];
for (let f = 0; f < 4; f++) {
  blocks[I.DRAGON_HEAD + f] = {
    name: "Dragon Head",
    faces: { top: "dragon_head", bottom: "dragon_head", side: "dragon_head", front: "dragon_head_front" },
    frontFace: DIR_FACE[f],
    shape: "dragon_head",
    opaque: false,
    box: HEAD_BOX,
    collision: [HEAD_BOX],
    hardness: 1,
    sound: "stone",
    ...(f ? { item: I.DRAGON_HEAD } : { placeAs: (ctx) => I.DRAGON_HEAD + OPP[look(ctx)], itemBoxes: [HEAD_BOX] }),
  };
}

// The end portal frame: 13/16 tall, an eye in its socket or not; turned
// toward the portal it rings (toward whoever put it down, as vanilla).
const FRAME_BOX = [0, 0, 0, 1, 13 * S, 1];
const FRAME_EYE = [4 * S, 13 * S, 4 * S, 12 * S, 1, 12 * S];
for (let v = 0; v < 8; v++) {
  const eye = v >= 4;
  blocks[I.END_PORTAL_FRAME + v] = {
    name: "End Portal Frame",
    // (its bottom face, on the floor, carries the eye's tile for the eye's box)
    faces: { top: "end_portal_frame_top", bottom: "end_portal_frame_eye", side: "end_portal_frame_side" },
    shape: "end_portal_frame",
    opaque: false,
    box: eye ? [0, 0, 0, 1, 1, 1] : FRAME_BOX,
    collision: eye ? [FRAME_BOX, FRAME_EYE] : [FRAME_BOX],
    emission: eye ? 1 : 0,
    ...UNBREAKABLE,
    sound: "glass",
    ...(v ? { item: I.END_PORTAL_FRAME } : { placeAs: (ctx) => I.END_PORTAL_FRAME + OPP[look(ctx)], itemBoxes: [FRAME_BOX] }),
  };
  drops[I.END_PORTAL_FRAME + v] = none;
}

// The portal the frame at (x, y, z) completes, if it does: the 3 x 3 cells
// inside (x, y, z, END_PORTAL, ...), else null. get(x, y, z): the block.
export function portalOfFrame(get, x, y, z) {
  const id = get(x, y, z);
  if (!isFrame(id)) return null;
  const f = frameFacing(id);
  const px = FZ[f];
  const pz = FX[f];
  for (let k = -1; k <= 1; k++) {
    const cx = x + FX[f] * 2 + px * k;
    const cz = z + FZ[f] * 2 + pz * k;
    if (ringComplete(get, cx, y, cz)) {
      const cells = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cells.push(cx + dx, y, cz + dz, I.END_PORTAL);
      return cells;
    }
  }
  return null;
}
// (every side d of the ring around (cx, cz): three frames with eyes, turned back toward it)
function ringComplete(get, cx, y, cz) {
  for (let d = 0; d < 4; d++) {
    for (let k = -1; k <= 1; k++) {
      const id = get(cx + FX[d] * 2 + FZ[d] * k, y, cz + FZ[d] * 2 + FX[d] * k);
      if (!isFrame(id) || !frameHasEye(id) || frameFacing(id) !== OPP[d]) return false;
    }
  }
  return true;
}
// An eye of ender into an empty frame; the portal opens when it is the twelfth.
function useFrame(ctx) {
  if (frameHasEye(ctx.id) || ctx.stack?.id !== I.EYE_OF_ENDER) return false;
  if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, ctx.id + 4)) return false;
  if (!ctx.creative) ctx.inventory.consumeSelected(1);
  ctx.audio?.playPlace?.("glass");
  const cells = portalOfFrame((x, y, z) => ctx.world.getBlock(x, y, z), ctx.x, ctx.y, ctx.z);
  if (cells) {
    ctx.world.setBlocks(cells);
    LIB.onEndPortal?.(cells);
  }
  return true;
}
for (let v = 0; v < 4; v++) blockUse[I.END_PORTAL_FRAME + v] = useFrame;

// The end portal and the end gateway: never meshed (js/dragon.js draws their
// starfield), walked into, unbreakable, light 15.
const PORTALISH = { render: RENDER.NONE, solid: false, opaque: false, skyPass: true, selectable: false, emission: 15, ...UNBREAKABLE, creative: false, sound: "glass" };
blocks[I.END_PORTAL] = { name: "End Portal", faces: "end_stone", ...PORTALISH };
blocks[I.END_GATEWAY] = { name: "End Gateway", faces: "end_stone", ...PORTALISH };
drops[I.END_PORTAL] = none;
drops[I.END_GATEWAY] = none;

// The strongholds' portal room spawner (silverfish: the creatures' part's;
// js/structures.js runs a spawner by its `spawns`).
blocks[I.SILVERFISH_SPAWNER] = {
  name: "Silverfish Spawner",
  faces: "spawner",
  render: RENDER.CUTOUT,
  opaque: false,
  skyPass: true,
  hardness: 5,
  tool: "pickaxe",
  minTier: 1,
  sound: "stone",
  xp: [15, 43],
  spawns: "silverfish",
};
drops[I.SILVERFISH_SPAWNER] = none;

// ---------- Items ----------

Object.assign(items, {
  [I.EYE_OF_ENDER]: { name: "Eye of Ender", icon: "eye_of_ender" },
  [I.DRAGON_BREATH]: { name: "Dragon's Breath", icon: "dragon_breath" },
  // (vanilla: 4 hunger, 2.4 saturation, eaten even when full; the eater is
  // sent up to 8 blocks away: js/dragon.js)
  [I.CHORUS_FRUIT]: { name: "Chorus Fruit", icon: "chorus_fruit", food: { hunger: 4, saturation: 2.4 }, alwaysEat: true },
  [I.POPPED_CHORUS_FRUIT]: { name: "Popped Chorus Fruit", icon: "popped_chorus_fruit" },
  [I.SHULKER_SHELL]: { name: "Shulker Shell", icon: "shulker_shell" },
  // (worn in the chest slot; glides with the jump key in the air: js/dragon.js)
  [I.ELYTRA]: { name: "Elytra", icon: "elytra", stack: 1, armor: { slot: 1, tier: 0, points: 0, durability: 432 }, elytra: true },
  [I.END_CRYSTAL]: { name: "End Crystal", icon: "end_crystal" },
});
// (A right click thrown with it, or set into a frame: the frame's own use first.)
itemUse[I.EYE_OF_ENDER] = (ctx) => !!LIB.throwEnderEye?.(ctx);
itemUse[I.END_CRYSTAL] = (ctx) => !!LIB.placeEndCrystal?.(ctx);

// ---------- Shapes (meshed the same on the main thread and in the workers) ----------

const _tiles6 = new Array(6);
const _eye6 = new Array(6);
function sixOf(id) {
  const t = LIB.BLOCK_INFO?.[id]?.faceTiles;
  for (let f = 0; f < 6; f++) _tiles6[f] = t ? t[f] : 0;
  return _tiles6;
}
export const shapes = {
  end_rod: {
    mesh: (m) => {
      const [rod, base] = ROD_BOXES[m.id - I.END_ROD];
      // (the base in purpur's colour)
      m.box(rod[0], rod[1], rod[2], rod[3], rod[4], rod[5], null, 0, null);
      m.box(base[0], base[1], base[2], base[3], base[4], base[5], sixOf(I.PURPUR_BLOCK), 0, null);
    },
  },
  chorus_plant: {
    mesh: (m) => {
      const mask = chorusMask((dx, dy, dz) => m.neighbor(dx, dy, dz));
      // (the core's face hidden where an arm leaves it; an arm's inner end too)
      m.box(CHORUS_CORE[0], CHORUS_CORE[1], CHORUS_CORE[2], CHORUS_CORE[3], CHORUS_CORE[4], CHORUS_CORE[5], null, mask, null);
      for (let f = 0; f < 6; f++) {
        if (!(mask & bit(f))) continue;
        const b = CHORUS_ARM[f];
        const n = m.neighbor(FACE_DIR[f][0], FACE_DIR[f][1], FACE_DIR[f][2]);
        // (against another plant's arm: the meeting faces are inside)
        const outer = isChorus(n) ? bit(f) : 0;
        m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, bit(FACE_OPP[f]) | outer, null);
      }
    },
  },
  dragon_egg: {
    mesh: (m) => {
      for (let i = 0; i < EGG_BOXES.length; i++) {
        const b = EGG_BOXES[i];
        // (a layer's top under the next one's bottom: only the ring of it shows)
        m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, null);
      }
    },
  },
  dragon_head: { mesh: (m) => m.box(HEAD_BOX[0], HEAD_BOX[1], HEAD_BOX[2], HEAD_BOX[3], HEAD_BOX[4], HEAD_BOX[5], null, 0, null) },
  end_portal_frame: {
    mesh: (m) => {
      m.box(0, 0, 0, 1, 13 * S, 1, null, 0, null);
      if (!frameHasEye(m.id)) return;
      // (the eye in its own tile: the frame's bottom face, always on the floor)
      const t = m.tile(FACE.NY);
      for (let f = 0; f < 6; f++) _eye6[f] = t;
      m.box(FRAME_EYE[0], FRAME_EYE[1], FRAME_EYE[2], FRAME_EYE[3], FRAME_EYE[4], FRAME_EYE[5], _eye6, bit(FACE.NY), null);
    },
  },
};

// ---------- Recipes ----------

export const recipes = () => {
  const out = [];
  const shaped = (pattern, key, result, count = 1) => out.push({ type: "shaped", pattern, key, result: [result, count] });
  const shapeless = (ingredients, result, count = 1) => out.push({ type: "shapeless", ingredients, result: [result, count] });
  // (the Nether's things: only once its module has them)
  if (I.BLAZE_POWDER) shapeless([I.ENDER_PEARL, I.BLAZE_POWDER], I.EYE_OF_ENDER, 1);
  if (I.BLAZE_ROD) shaped(["B", "P"], { B: I.BLAZE_ROD, P: I.POPPED_CHORUS_FRUIT }, I.END_ROD + FACE.PY, 4);
  if (I.GHAST_TEAR) shaped(["GGG", "GEG", "GTG"], { G: BLOCK.GLASS, E: I.EYE_OF_ENDER, T: I.GHAST_TEAR }, I.END_CRYSTAL, 1);
  shaped(["##", "##"], { "#": I.END_STONE }, I.END_STONE_BRICKS, 4);
  shaped(["##", "##"], { "#": I.POPPED_CHORUS_FRUIT }, I.PURPUR_BLOCK, 4);
  out.push({ type: "smelting", input: I.CHORUS_FRUIT, result: [I.POPPED_CHORUS_FRUIT, 1], xp: 0.1, time: 10 });
  if (HAS_FAMILIES) {
    for (const fam of FAMILIES) {
      shaped(["#  ", "## ", "###"], { "#": fam.full }, fam.stairs, 4);
      shaped(["###"], { "#": fam.full }, fam.slab, 6);
      if (fam.wall) shaped(["###", "###"], { "#": fam.full }, fam.wall, 6);
    }
    shaped(["#", "#"], { "#": I.PURPUR_SLAB }, I.PURPUR_PILLAR, 1);
  }
  return out;
};

// ---------- Textures (16 tiles) ----------

const pal = (kit, list) => list.map(kit.hex);
const END_STONE_RAMP = [0xb8b67c, 0xc6c48a, 0xd2d197, 0xdcdca2, 0xe3e4ab, 0xebedb6];
const PURPUR_RAMP = [0x7b4f7b, 0x8a5c8a, 0x9a6a99, 0xa877a7, 0xb584b4, 0xc293c1];
const CHORUS_RAMP = [0x3d2440, 0x4c2f50, 0x5c3a60, 0x6d4772, 0x7f5684, 0x936799];

// End stone: pale yellow, pitted with darker dents.
function endStone(t, kit, salt = 0) {
  const ramp = pal(kit, END_STONE_RAMP);
  const pits = t.voronoi(18, 3 + salt);
  t.forEach((x, y) => {
    const v = pits(x, y);
    let f = 0.55 + (t.fbm(x, y, 4, 3, salt) - 0.5) * 0.6 + (t.rand() - 0.5) * 0.18;
    if (v.d1 < 1.7) f -= 0.42 * (1 - v.d1 / 1.7);
    else if (v.d1 < 2.6) f += 0.12;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// Bricks in rows `h` pixels high, `w` wide, every other row offset by half.
function bricks(t, kit, ramp, w, h, mortar, salt = 0) {
  t.forEach((x, y) => {
    const row = Math.floor(y / h);
    const yy = y % h;
    const xx = (x + (row & 1 ? w / 2 : 0)) % w;
    if (yy === h - 1 || xx === w - 1) {
      t.set(x, y, kit.hex(mortar));
      return;
    }
    const brick = kit.hashInt(row, Math.floor((x + (row & 1 ? w / 2 : 0)) / w), t.seed + salt);
    let f = 0.5 + (brick - 0.5) * 0.25 + (t.fbm(x, y, 4, 2, salt) - 0.5) * 0.45 + (t.rand() - 0.5) * 0.12;
    if (yy === 0 || xx === 0) f += 0.22;
    if (yy === h - 2 || xx === w - 2) f -= 0.18;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// Purpur: squares of 8 pixels a side with bevelled edges.
function purpurSquares(t, kit) {
  const ramp = pal(kit, PURPUR_RAMP);
  t.forEach((x, y) => {
    const xx = x & 7;
    const yy = y & 7;
    const cell = kit.hashInt(x >> 3, y >> 3, t.seed);
    let f = 0.52 + (cell - 0.5) * 0.18 + (t.fbm(x, y, 8, 2) - 0.5) * 0.3 + (t.rand() - 0.5) * 0.1;
    if (xx === 0 || yy === 0) f += 0.28;
    if (xx === 7 || yy === 7) f -= 0.34;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// A pillar's fluting: ridges along one axis (x: across the tile's u).
function fluting(t, kit, across) {
  const ramp = pal(kit, PURPUR_RAMP);
  t.forEach((x, y) => {
    const u = across ? y : x;
    const v = across ? x : y;
    const k = u % 8;
    let f = 0.5 + [0.3, 0.12, 0.04, 0, -0.04, -0.1, -0.2, -0.36][k] + (t.fbm(x, y, 8, 2) - 0.5) * 0.25 + (t.rand() - 0.5) * 0.08;
    if (v === 0) f += 0.2;
    if (v === 31) f -= 0.2;
    t.set(x, y, kit.ramp(ramp, f));
  });
}

export const tiles = {
  end_stone: (t, kit) => endStone(t, kit),
  end_stone_bricks: (t, kit) => bricks(t, kit, pal(kit, END_STONE_RAMP), 16, 8, 0x9c9a66),
  purpur_block: (t, kit) => purpurSquares(t, kit),
  purpur_pillar: (t, kit) => fluting(t, kit, false),
  purpur_pillar_rot: (t, kit) => fluting(t, kit, true),
  purpur_pillar_top: (t, kit) => {
    // Squares within squares, bevelled.
    const ramp = pal(kit, PURPUR_RAMP);
    t.forEach((x, y) => {
      const ring = Math.min(x, y, 31 - x, 31 - y);
      const k = ring % 6;
      let f = 0.5 + (k === 0 ? 0.3 : k === 5 ? -0.32 : 0) + (t.fbm(x, y, 8, 2) - 0.5) * 0.25 + (t.rand() - 0.5) * 0.08;
      if (ring >= 12) f = 0.62 + (t.rand() - 0.5) * 0.1;
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  // A white glowing stick, its edges pale lavender (the base is purpur).
  end_rod: (t, kit) => {
    t.forEach((x, y) => {
      const e = Math.min(x % 8, 7 - (x % 8)) / 3.5;
      const v = 0.86 + Math.min(1, e) * 0.14 + (t.rand() - 0.5) * 0.04;
      t.set(x, y, [Math.min(255, 236 * v + 10), Math.min(255, 226 * v + 8), 255 * Math.min(1, v + 0.04)]);
    });
  },
  chorus_plant: (t, kit) => {
    const ramp = pal(kit, CHORUS_RAMP);
    const spots = t.voronoi(14, 5);
    t.forEach((x, y) => {
      const v = spots(x, y);
      let f = 0.45 + (t.fbm(x, y, 4, 3) - 0.5) * 0.5 + (t.rand() - 0.5) * 0.15;
      if (v.d1 < 2.2) f += 0.38 * (1 - v.d1 / 2.2);
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  chorus_flower: (t, kit) => chorusFlower(t, kit, false),
  chorus_flower_dead: (t, kit) => chorusFlower(t, kit, true),
  // Black with purple flecks.
  dragon_egg: (t, kit) => {
    t.forEach((x, y) => {
      const n = t.fbm(x, y, 4, 3);
      const fleck = t.noise(x, y, 16, 7) > 0.74 || t.rand() < 0.04;
      const k = 0.5 + (n - 0.5) * 0.6;
      t.set(x, y, fleck ? [Math.round(110 * k + 40), Math.round(30 * k + 10), Math.round(150 * k + 50)] : [Math.round(14 + k * 18), Math.round(8 + k * 10), Math.round(20 + k * 22)]);
    });
  },
  // The dragon's scales (near black), and its face: purple eyes, a nostril ridge.
  dragon_head: (t) => t.forEach((x, y) => {
    const scale = ((x >> 2) + (y >> 2)) & 1;
    const v = 22 + scale * 8 + Math.round((t.fbm(x, y, 8, 2) - 0.5) * 14) + Math.round((t.rand() - 0.5) * 6);
    t.set(x, y, [v, v - 2, v + 4]);
  }),
  dragon_head_front: (t) => t.forEach((x, y) => {
    const scale = ((x >> 2) + (y >> 2)) & 1;
    let c = [24 + scale * 8, 22 + scale * 8, 28 + scale * 8];
    const eye = y >= 8 && y <= 11 && ((x >= 6 && x <= 11) || (x >= 20 && x <= 25));
    if (eye) c = y === 9 || y === 10 ? [240, 150, 255] : [190, 60, 230];
    if (y >= 22 && y <= 23 && x >= 8 && x <= 23) c = [10, 8, 12]; // (the mouth)
    if (y === 17 && (x === 12 || x === 19)) c = [60, 54, 66]; // (the nostrils)
    t.set(x, y, c);
  }),
  // The frame: teal-green stone round its socket, the end stone border.
  end_portal_frame_top: (t, kit) => {
    endStone(t, kit, 11);
    t.forEach((x, y) => {
      const r = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
      if (r > 13.5) return;
      const n = t.fbm(x, y, 4, 2, 9) * 0.5 + t.rand() * 0.2;
      let c = [Math.round(36 + n * 40), Math.round(84 + n * 50), Math.round(72 + n * 44)];
      if (r > 12.5) c = [26, 52, 46];
      if (r < 7.5) c = r > 6.5 ? [18, 36, 32] : [Math.round(28 + n * 20), Math.round(54 + n * 30), Math.round(48 + n * 26)];
      t.set(x, y, c);
    });
  },
  end_portal_frame_side: (t, kit) => {
    endStone(t, kit, 12);
    t.forEach((x, y) => {
      // (the top 3/16 below the rim: the teal band of the frame)
      if (y >= 6 && y <= 9) {
        const n = t.fbm(x, y, 8, 2, 4) * 0.5 + t.rand() * 0.2;
        t.set(x, y, y === 9 ? [24, 48, 42] : [Math.round(40 + n * 40), Math.round(92 + n * 46), Math.round(80 + n * 40)]);
      }
    });
  },
};
// The eye: a green iris round a dark slit (its box shows the middle of the tile on top).
tiles.end_portal_frame_eye = (t) => t.forEach((x, y) => {
  const d = Math.hypot(x - 15.5, y - 15.5) / 9;
  let c = [Math.round(30 + 100 * Math.max(0, 1 - d)), Math.round(100 + 120 * Math.max(0, 1 - d)), Math.round(64 + 70 * Math.max(0, 1 - d))];
  if (Math.abs(x - 15.5) < 1.5 && Math.abs(y - 15.5) < 5) c = [6, 20, 12];
  if (d > 1) c = [18 + (t.rand() * 8) | 0, 58, 38];
  t.set(x, y, c);
});
function chorusFlower(t, kit, dead) {
  const ramp = dead ? pal(kit, [0x4a3a3e, 0x5a474b, 0x6a5559, 0x7a6468, 0x8a7378, 0x9a8488]) : pal(kit, [0x7a5a86, 0x8d6b99, 0xa07dac, 0xb390bf, 0xc6a3d1, 0xd9b7e2]);
  t.forEach((x, y) => {
    const cx = (x % 16) - 7.5;
    const cy = (y % 16) - 7.5;
    const r = Math.hypot(cx, cy);
    const petal = Math.abs(Math.sin(Math.atan2(cy, cx) * 2)) * 0.25;
    let f = 0.55 - r / 18 + petal + (t.fbm(x, y, 4, 2) - 0.5) * 0.3 + (t.rand() - 0.5) * 0.1;
    if (r < 2) f = 0.95;
    if ((x & 15) === 0 || (y & 15) === 0) f -= 0.25;
    t.set(x, y, kit.ramp(ramp, f));
  });
}

export const tileRelief = {
  end_stone: [2.4, 0.82, 0.6],
  end_stone_bricks: [2.6, 0.8, 1],
  purpur_block: [2.2, 0.6, 1],
  purpur_pillar: [2.4, 0.6, 1],
  purpur_pillar_rot: [2.4, 0.6, 1],
  purpur_pillar_top: [2.2, 0.6, 1],
  end_rod: [0.6, 0.3, 0.2],
  chorus_plant: [2, 0.7, 1],
  chorus_flower: [1.8, 0.7, 1],
  chorus_flower_dead: [1.8, 0.8, 1],
  dragon_egg: [1.4, 0.35, 0.6],
  dragon_head: [1.6, 0.5, 0.6],
  dragon_head_front: [1.6, 0.5, 0.6],
  end_portal_frame_top: [2, 0.6, 0.8],
  end_portal_frame_side: [2, 0.7, 0.8],
  end_portal_frame_eye: [1, 0.3, 0.5],
};

// ---------- Icons ----------
// Drawn as the other modules' (itemtextures.js): shapes in colour ramps,
// lit from the top left, outlined.
const lit = (k = 0.4, d = -0.2, s = 30) => (x, y) => (x + y < s ? k : d);
export const icons = {
  eye_of_ender: (kit) => {
    const c = new kit.Canvas();
    const green = kit.ramp(0x0d3a24, 0x1d6b3e, 0x34a05a, 0x6fd28a, 0xc6f5cf);
    c.disc(0, 16, 16, 10.5, 10.5, (x, y) => (Math.hypot(x - 12.5, y - 12.5) < 4.5 ? 0.75 : x + y < 32 ? 0.2 : -0.35));
    c.fill(1, (x, y) => Math.abs(x - 16) < 1.6 && Math.abs(y - 16) < 6.5, () => -1);
    c.disc(0, 12, 12, 1.6, 1.6, () => 1.2);
    return c.render([green, kit.RAMPS.coal], [4, 18, 10]);
  },
  dragon_breath: (kit) => {
    // A glass bottle of pink-purple mist.
    const c = new kit.Canvas();
    const glass = kit.ramp(0x6f8ea0, 0x93b3c4, 0xb7d3e0, 0xd8eef6, 0xffffff);
    const mist = kit.ramp(0x6a1f5e, 0x9a3384, 0xc955aa, 0xe68bcb, 0xf8c8ea);
    c.disc(1, 16, 21, 8.5, 8, (x, y) => (x + y < 34 ? 0.5 : -0.1));
    c.fill(0, (x, y) => x > 13 && x < 19 && y > 6 && y < 14, () => 0.2);
    c.fill(0, (x, y) => x > 12 && x < 20 && y > 4 && y < 7, () => 0.6);
    for (const [x, y, r] of [[13, 19, 2.2], [19, 23, 1.8], [16, 25, 1.5]]) c.disc(1, x, y, r, r, () => 1);
    return c.render([glass, mist], [40, 30, 50]);
  },
  chorus_fruit: (kit) => {
    const c = new kit.Canvas();
    const r = kit.ramp(0x3d2440, 0x5c3a60, 0x7f5684, 0xa47aa9, 0xd2b0d6);
    for (const [x, y, s] of [[13, 13, 6], [20, 15, 5.5], [14, 21, 5.5], [21, 22, 5], [17, 17, 6]]) c.disc(0, x, y, s, s, lit(0.35, -0.2, x + y));
    for (const [x, y] of [[11, 11], [19, 13], [13, 19]]) c.disc(0, x, y, 1.3, 1.3, () => 1.1);
    return c.render([r], [24, 10, 26]);
  },
  popped_chorus_fruit: (kit) => {
    const c = new kit.Canvas();
    const r = kit.ramp(0x7a5a86, 0xa07dac, 0xc6a3d1, 0xe2c6ea, 0xfaeefd);
    for (const [x, y, s] of [[13, 13, 6], [20, 15, 5.5], [14, 21, 5.5], [21, 22, 5], [17, 17, 6]]) c.disc(0, x, y, s, s, lit(0.4, -0.15, x + y));
    c.line(0, 10, 16, 22, 18, 1, () => -0.8); // (the popped seam)
    c.line(0, 16, 10, 17, 24, 1, () => -0.8);
    return c.render([r], [50, 30, 56]);
  },
  shulker_shell: (kit) => {
    const c = new kit.Canvas();
    const r = kit.ramp(0x4a2a52, 0x6d3f78, 0x9258a0, 0xb47dc0, 0xd8aee0);
    c.poly(0, [[5, 20], [7, 9], [16, 5], [25, 9], [27, 20], [16, 23]], lit(0.4, -0.1, 30));
    c.poly(0, [[5, 20], [16, 23], [27, 20], [27, 25], [16, 28], [5, 25]], () => -0.4);
    c.line(0, 9, 13, 23, 13, 1, () => 0.8);
    return c.render([r], [30, 16, 34]);
  },
  elytra: (kit) => {
    const c = new kit.Canvas();
    const r = kit.ramp(0x3a3a4a, 0x55556a, 0x737388, 0x9898ad, 0xc4c4d6);
    c.poly(0, [[15, 5], [8, 8], [5, 16], [6, 27], [11, 22], [15, 14]], (x, y) => (x < 10 ? 0.4 : 0));
    c.poly(0, [[17, 5], [24, 8], [27, 16], [26, 27], [21, 22], [17, 14]], (x) => (x > 22 ? -0.2 : 0.15));
    c.line(0, 9, 10, 8, 24, 0.8, () => -0.7);
    c.line(0, 23, 10, 24, 24, 0.8, () => -0.7);
    return c.render([r], [20, 20, 28]);
  },
  end_crystal: (kit) => {
    const c = new kit.Canvas();
    const glass = kit.ramp(0x7a5f8a, 0xa58ab5, 0xcbb4d8, 0xe8dcef, 0xffffff);
    const core = kit.ramp(0x6a1640, 0x9c2260, 0xd23a86, 0xf27ab2, 0xffc8e0);
    c.poly(0, [[16, 3], [28, 10], [28, 22], [16, 29], [4, 22], [4, 10]], (x, y) => (x + y < 28 ? 0.45 : 0));
    c.poly(1, [[16, 9], [22, 13], [22, 19], [16, 23], [10, 19], [10, 13]], (x, y) => (x + y < 30 ? 0.5 : -0.1));
    c.line(0, 16, 3, 16, 9, 0.8, () => 1);
    return c.render([glass, core], [40, 20, 46]);
  },
};
