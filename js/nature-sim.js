// Fire (Round 11), as Minecraft's: a fire block ticks every 1.5-2 s (30-40
// game ticks) while its chunk is loaded, ages, burns the flammable blocks
// around it (some catch fire themselves, the rest vanish) and spreads to the
// air beside flammable blocks up to 4 above it; with nothing left to burn it
// goes out (vanilla's FireBlock.tick, on Normal; there is no rain). The
// flammability table is js/content/nature.js's.
//
// The host runs every fire (online, `enabled` says when: a guest's fires come
// to the host as edits, and the results go out as edits). An edit that
// makes a fire wakes it; a fire's random tick hands one the sim doesn't know
// (saved with the world) back to it (world.natureSim.fire.adopt).
import { BLOCK, IS_SOLID, IS_OPAQUE } from "./blocks.js";
import { WORLD_HEIGHT } from "./constants.js";
import { FIRE } from "./content/ids.js";
import { flammability } from "./content/nature.js";
import { LavaSim } from "./lavasim.js";

const BUDGET_PER_FRAME = 64;
const MAX_FIRES = 4096; // (a forest fire's front; more wait for their random tick)
const DIFFICULTY = 2; // (Normal: spread odds + 7 per level)
const STEPS = [
  [1, 0, 0, 300],
  [-1, 0, 0, 300],
  [0, -1, 0, 250],
  [0, 1, 0, 250],
  [0, 0, 1, 300],
  [0, 0, -1, 300],
];

export class FireSim {
  constructor(world) {
    this.world = world;
    this.time = 0;
    this.enabled = () => true; // (main.js: the host or a single player)
    this.rand = Math.random;
    this._due = new Map(); // "x,y,z" -> { at, age }
    this._out = [];
    world.changeListeners.push((changed) => this._onEdit(changed));
  }

  get count() {
    return this._due.size;
  }

  // (Every edit, a guest's too: the host runs the fires.)
  _onEdit(changed) {
    if (!this.enabled()) return;
    const w = this.world;
    for (let i = 0; i < changed.length; i += 3) if (w.getBlock(changed[i], changed[i + 1], changed[i + 2]) === FIRE) this.adopt(changed[i], changed[i + 1], changed[i + 2]);
  }

  // A fire at (x, y, z) to tick in 1.5-2 s (age: 0 for a new one).
  adopt(x, y, z, age = 0) {
    if (!this.enabled()) return;
    const key = `${x},${y},${z}`;
    if (this._due.has(key) || this._due.size >= MAX_FIRES) return;
    this._due.set(key, { at: this.time + 1.5 + this.rand() * 0.5, age });
  }

  update(dt) {
    this.time += dt;
    if (!this._due.size) return;
    if (!this.enabled()) {
      this._due.clear();
      return;
    }
    let n = 0;
    const out = this._out;
    out.length = 0;
    const lit = [];
    for (const [key, f] of this._due) {
      if (n >= BUDGET_PER_FRAME) break;
      if (f.at > this.time) continue;
      n++;
      this._due.delete(key);
      const [x, y, z] = key.split(",").map(Number);
      if (!this.world.getChunk(x >> 4, z >> 4) || this.world.getBlock(x, y, z) !== FIRE) continue;
      const age = this._tick(x, y, z, f.age, out, lit);
      if (age >= 0) this._due.set(key, { at: this.time + 1.5 + this.rand() * 0.5, age });
    }
    if (out.length) this.world.setBlocks(out.slice());
    for (let i = 0; i < lit.length; i += 4) {
      const key = `${lit[i]},${lit[i + 1]},${lit[i + 2]}`;
      const f = this._due.get(key);
      if (f) f.age = lit[i + 3]; // (a fire lit from another keeps its age)
    }
  }

  // One tick of the fire at (x, y, z): its writes go in `out`, the fires it
  // lights (with their ages) in `lit`. Returns its new age, or -1 when out.
  _tick(x, y, z, age, out, lit) {
    const w = this.world;
    const { ignite, burn } = flammability();
    const rand = this.rand;
    const below = w.getBlock(x, y - 1, z);
    const grounded = IS_SOLID[below] === 1 && IS_OPAQUE[below] === 1;
    let fuel = false;
    for (const [dx, dy, dz] of STEPS) if (ignite[w.getBlock(x + dx, y + dy, z + dz)]) fuel = true;
    if (!grounded && !fuel) {
      out.push(x, y, z, BLOCK.AIR); // (nothing holds it)
      return -1;
    }
    const next = Math.min(15, age + (Math.floor(rand() * 3) >> 1));
    if (!fuel) {
      if (age > 3) {
        out.push(x, y, z, BLOCK.AIR);
        return -1;
      }
      return next;
    }
    if (age === 15 && rand() < 0.25 && !ignite[below]) {
      out.push(x, y, z, BLOCK.AIR);
      return -1;
    }
    // Burn the neighbours: gone, or alight themselves.
    for (const [dx, dy, dz, chance] of STEPS) {
      const bx = x + dx;
      const by = y + dy;
      const bz = z + dz;
      const odds = burn[w.getBlock(bx, by, bz)];
      if (!odds || Math.floor(rand() * chance) >= odds) continue;
      if (Math.floor(rand() * (age + 10)) < 5) {
        out.push(bx, by, bz, FIRE);
        lit.push(bx, by, bz, Math.min(15, age + (Math.floor(rand() * 5) >> 2)));
      } else out.push(bx, by, bz, BLOCK.AIR);
    }
    // Spread to the air near flammable blocks (more easily upward).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 4; dy++) {
          if (!dx && !dy && !dz) continue;
          const px = x + dx;
          const py = y + dy;
          const pz = z + dz;
          if (py < 1 || py >= WORLD_HEIGHT || w.getBlock(px, py, pz) !== BLOCK.AIR) continue;
          let odds = 0;
          for (const [sx, sy, sz] of STEPS) odds = Math.max(odds, ignite[w.getBlock(px + sx, py + sy, pz + sz)]);
          if (!odds) continue;
          const k = 100 + (dy > 1 ? (dy - 1) * 100 : 0);
          const chance = Math.floor((odds + 40 + DIFFICULTY * 7) / (age + 30));
          if (chance > 0 && Math.floor(rand() * k) <= chance) {
            out.push(px, py, pz, FIRE);
            lit.push(px, py, pz, Math.min(15, age + (Math.floor(rand() * 5) >> 2)));
          }
        }
      }
    }
    return next;
  }
}

// The world's nature systems beside the water (main.js builds one, after the
// WaterSim: world.natureSim): flowing lava (every player, for their own
// edits, like water) and fire (the host's: main.js sets fire.enabled).
export class NatureSim {
  constructor(world) {
    this.lava = new LavaSim(world);
    this.fire = new FireSim(world);
    world.natureSim = this;
  }

  update(dt) {
    this.lava.update(dt);
    this.fire.update(dt);
  }
}
