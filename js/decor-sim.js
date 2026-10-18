// Concrete powder against water (Round 11, js/content/decor.js): a powder
// block touching water on a side or above turns into concrete the moment it
// does: placed by a water's edge, water poured or flowing next to it, or
// landing by it; powder left over water drops into the water's first cell
// and sets there, as vanilla's falling powder does. Every edit batch is
// looked at (World.changeListeners), only the peer that made it acts (as
// falling.js: online the result travels as an ordinary edit); a random tick
// catches any powder the edits missed.
//
// Also: the powder's four colours share a tile (a quadrant each), so the
// world's per-block colours (break particles, distant terrain) are set here
// from the colours themselves. Built right after the World, before the LOD
// system reads the palette.
import { BLOCK } from "./blocks.js";
import { CONCRETE_POWDER, POWDER_COLORS, isPowder, concreteOf, powderTouchesWater, isWater } from "./content/decor.js";

// Where powder touched by water at a cell may be: beside it, under it, and
// above it (it sinks into the water).
const NEAR = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0],
  [0, 1, 0],
];

export class DecorSim {
  constructor(world) {
    this.world = world;
    this.hardened = 0; // (tests and stats)
    this._fixColors();
    this._out = [];
    world.changeListeners.push((changed, opts) => {
      if (!opts?.remote) this._check(changed, opts);
    });
  }

  _fixColors() {
    const w = this.world;
    POWDER_COLORS.forEach((hex, i) => {
      const id = CONCRETE_POWDER + i;
      const srgb = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
      if (w.blockColors) w.blockColors[id] = srgb;
      const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      if (w.facePalette) for (const p of [w.facePalette.top, w.facePalette.side]) p.set(lin, id * 3);
    });
  }

  // The cells an edit batch changed: powder there or next to water there.
  _check(changed, opts) {
    const w = this.world;
    const out = this._out;
    out.length = 0;
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const y = changed[i + 1];
      const z = changed[i + 2];
      const id = w.getBlock(x, y, z);
      if (isPowder(id)) this._settle(x, y, z, id, out);
      else if (isWater(id)) {
        for (let k = 0; k < NEAR.length; k++) {
          const nx = x + NEAR[k][0];
          const ny = y + NEAR[k][1];
          const nz = z + NEAR[k][2];
          const n = w.getBlock(nx, ny, nz);
          if (isPowder(n)) this._settle(nx, ny, nz, n, out);
        }
      }
    }
    if (!out.length) return;
    w.setBlocks(out.slice(), { recordEdit: opts?.recordEdit !== false });
  }

  // Powder at a cell: concrete if water touches it; over water, it sinks
  // into the water's cell and sets there.
  _settle(x, y, z, id, out) {
    const w = this.world;
    for (let i = 0; i < out.length; i += 4) if (out[i] === x && out[i + 1] === y && out[i + 2] === z) return;
    if (y > 0 && w.getBlock(x, y - 1, z) === BLOCK.WATER) {
      out.push(x, y, z, BLOCK.AIR, x, y - 1, z, concreteOf(id));
      this.hardened++;
      return;
    }
    if (!powderTouchesWater(w, x, y, z)) return;
    out.push(x, y, z, concreteOf(id));
    this.hardened++;
  }
}
