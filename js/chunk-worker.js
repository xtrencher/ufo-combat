// Web Worker that generates terrain chunks off the main thread (see
// World.enableGenWorkers in world.js). It runs the very same generator as the
// main thread (terrain.js is pure: no three.js, no DOM), so a chunk made here
// is block for block the chunk the main thread would have made.
//
// Messages in:  { type: "init", seed }
//               { type: "gen", cx, cz }
// Messages out: { type: "chunk", cx, cz, blocks }   (blocks transferred)
import { TerrainGenerator } from "./terrain.js";
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
  }
};
