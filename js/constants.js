// World-layout constants shared by rendering and pure-logic modules.
// Deliberately has no imports (no three.js), so logic modules that depend
// on it can also be unit-tested directly in Node.

export const CHUNK_SIZE = 16;
// 128 blocks tall (Round 3; it was 64): room for real mountain ranges. The
// block index is y-major (y * 256 + z * 16 + x), so edits saved in a
// 64-tall world keep their meaning, and it still fits the 16-bit index of
// the saved-edit format (storage.js).
export const WORLD_HEIGHT = 128;
export const SEA_LEVEL = 24;

// Index of a block inside a chunk's flat block array (x fastest, then z, then y).
export function blockIndex(lx, ly, lz) {
  return ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
}

export function floorDiv(a, b) {
  return Math.floor(a / b);
}

export function chunkKey(cx, cz) {
  return cx + "," + cz;
}
