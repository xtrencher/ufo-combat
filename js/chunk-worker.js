// Web Worker that generates terrain chunks off the main thread (see
// World.enableGenWorkers in world.js). It runs the very same generator as the
// main thread (terrain.js is pure: no three.js, no DOM), so a chunk made here
// is block for block the chunk the main thread would have made.
//
// It also meshes chunks (the costly half of mesher.js; world.js takes the
// padded volume on the main thread, where the chunks and their light live).
//
// (Round 12) It makes the chunks of the dimension the world is in (each
// dimension's generator made once, js/dim-registry.js); a chunk is answered
// with the epoch of the dimension it was made for (world.js drops a stale one).
//
// Messages in:  { type: "init", seed, opts, dim, epoch }
//               { type: "dim", dim, epoch }   (the world went to another dimension)
//               { type: "gen", cx, cz }
//               { type: "mesh", token, cx, cz, maxY, fancy, blocks, light }
//                 (the padded volume: blocks Uint16Array, light Uint8Array)
// Messages out: { type: "chunk", cx, cz, blocks, epoch }   (Uint16Array, transferred)
//               { type: "mesh", token, buffers }    (the arrays transferred)
import { createGenerator, OVERWORLD } from "./dim-registry.js";
import { meshPadded } from "./mesher.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

let terrain = null;
let seed = 0;
let opts = null;
let epoch = 0;
const terrains = new Map(); // dim -> generator

function terrainOf(dim) {
  let t = terrains.get(dim);
  if (!t) terrains.set(dim, (t = createGenerator(dim, seed, opts)));
  return t;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    seed = m.seed;
    opts = m.opts;
    epoch = m.epoch | 0;
    terrains.clear();
    terrain = terrainOf(typeof m.dim === "string" ? m.dim : OVERWORLD);
  } else if (m.type === "dim") {
    epoch = m.epoch | 0;
    if (opts !== null) terrain = terrainOf(m.dim);
  } else if (m.type === "gen" && terrain) {
    const chunk = { cx: m.cx, cz: m.cz, blocks: new Uint16Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE) };
    terrain.generate(chunk);
    self.postMessage({ type: "chunk", cx: m.cx, cz: m.cz, blocks: chunk.blocks, epoch }, [chunk.blocks.buffer]);
  } else if (m.type === "mesh") {
    const buffers = meshPadded(m.blocks, m.light, m.cx, m.cz, m.maxY, { fancyLeaves: m.fancy });
    const transfer = [];
    for (const b of Object.values(buffers)) if (b) transfer.push(b.position.buffer, b.uv.buffer, b.data.buffer, b.extra.buffer, b.index.buffer);
    self.postMessage({ type: "mesh", token: m.token, buffers }, transfer);
  }
};
