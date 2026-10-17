// Test-only blocks (Round 11): a block and a slab with 16-bit ids, to prove
// every path of the id space and the registries (placing, meshing in the
// workers, light, saves, items, online, distant terrain): see
// tools/r11-engine16-tests.mjs. Never in the creative palette or the terrain.
// Ids: blocks 4064-4095.

export const DEBUG = Object.freeze({ SLAB: 4094, BLOCK: 4095 });

export const blocks = {
  [DEBUG.BLOCK]: { name: "Debug Block", faces: "debug", hardness: 0.5, sound: "stone", creative: false },
  [DEBUG.SLAB]: {
    name: "Debug Slab",
    faces: "debug",
    shape: "debug_slab",
    opaque: false, // (half a cell: light reaches it, the faces around it stay drawn)
    box: [0, 0, 0, 1, 0.5, 1],
    collision: [[0, 0, 0, 1, 0.5, 1]],
    hardness: 0.5,
    sound: "stone",
    creative: false,
  },
};

// The classic "missing texture": magenta and black squares.
export const tiles = {
  debug: (t, kit) => t.forEach((x, y) => t.set(x, y, ((x >> 3) + (y >> 3)) & 1 ? kit.hex(0x1a1a1a) : kit.hex(0xf03cf0))),
};

export const shapes = {
  debug_slab: { mesh: (m) => m.box(0, 0, 0, 1, 0.5, 1) },
};

// Right click turns the debug block into the debug slab (the block-use dispatch).
export const blockUse = {
  [DEBUG.BLOCK]: (ctx) => ctx.world.setBlock(ctx.x, ctx.y, ctx.z, DEBUG.SLAB),
};
