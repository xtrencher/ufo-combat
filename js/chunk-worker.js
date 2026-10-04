// Web Worker that generates terrain chunks off the main thread (see
// World.enableGenWorkers in world.js). It runs the very same generator as the
// main thread (terrain.js is pure: no three.js, no DOM), so a chunk made here
// is block for block the chunk the main thread would have made.
//
// It also meshes chunks (the costly half of mesher.js; world.js takes the
// padded volume on the main thread, where the chunks and their light live).
//
// Messages in:  { type: "init", seed }
//               { type: "gen", cx, cz }
//               { type: "mesh", token, cx, cz, maxY, fancy, blocks, light }
// Messages out: { type: "chunk", cx, cz, blocks }   (blocks transferred)
//               { type: "mesh", token, buffers }    (the arrays transferred)
import { TerrainGenerator } from "./terrain.js";
import { meshPadded } from "./mesher.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

let terrain = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    terrain = new TerrainGenerator(m.seed);
  } else if (m.type === "gen" && terrain) {
    const chunk = { cx: m.cx, cz: m.cz, blocks: new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE) };
    terrain.generate(chunk);
    self.postMessage({ type: "chunk", cx: m.cx, cz: m.cz, blocks: chunk.blocks }, [chunk.blocks.buffer]);
  } else if (m.type === "mesh") {
    const buffers = meshPadded(m.blocks, m.light, m.cx, m.cz, m.maxY, { fancyLeaves: m.fancy });
    const transfer = [];
    for (const b of Object.values(buffers)) if (b) transfer.push(b.position.buffer, b.uv.buffer, b.data.buffer, b.extra.buffer, b.index.buffer);
    self.postMessage({ type: "mesh", token: m.token, buffers }, transfer);
  }
};
