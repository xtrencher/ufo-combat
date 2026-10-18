// Vanilla mobs' items (Round 11): spawn eggs, for Creative (vanilla's: no
// recipe; a right click on a block makes the creature there, mobs.js
// requestSpawn through LIB.spawnMob; online a guest's is asked of the host).
// The mobs' drops are other modules' items (leather, wool, rotten flesh...:
// ids.js). Ids: items 640-703. What a content module may export, and its
// rules (imports only ./base.js and other content modules' id constants):
// see ./index.js.
import { LIB } from "./base.js";

// [id, kind, name, shell colour, spots colour] (vanilla's egg colours).
const EGGS = [
  [640, "zombie", "Zombie", 0x00afaf, 0x799c65],
  [641, "skeleton", "Skeleton", 0xc1c1c1, 0x494949],
  [642, "spider", "Spider", 0x342d27, 0xa80e0e],
  [643, "creeper", "Creeper", 0x0da70b, 0x101010],
  [644, "enderman", "Enderman", 0x161616, 0x050505],
  [645, "slime", "Slime", 0x51a03e, 0x7ebf6e],
  [646, "witch", "Witch", 0x340000, 0x51a03e],
  [647, "cow", "Cow", 0x443626, 0xa1a1a1],
  [648, "pig", "Pig", 0xf0a5a2, 0xdb635f],
  [649, "chicken", "Chicken", 0xa1a1a1, 0xff0000],
  [650, "sheep", "Sheep", 0xe7e7e7, 0xffb5b5],
  [651, "villager", "Villager", 0x563c33, 0xbd8b72],
  [652, "iron_golem", "Iron Golem", 0xdbcdc1, 0x74a332],
  [653, "cod", "Cod", 0xc1a76a, 0xe5c48b],
  [654, "salmon", "Salmon", 0xa00f10, 0x0e8474],
  [655, "wolf", "Wolf", 0xd7d3d3, 0xceaf96],
];
export const SPAWN_EGG_KIND = Object.fromEntries(EGGS.map(([id, kind]) => [id, kind]));

export const blocks = {};
export const items = {};
export const icons = {};
export const itemUse = {};

// A five-step ramp from one colour (dark to light), for the icon's shading.
function ramp(kit, color) {
  const [r, g, b] = kit.hex(color);
  return [0.5, 0.72, 0.9, 1.08, 1.25].map((k) => [Math.min(255, r * k + 6), Math.min(255, g * k + 6), Math.min(255, b * k + 6)]);
}

for (const [id, kind, name, shell, spots] of EGGS) {
  items[id] = { name: `${name} Spawn Egg`, icon: `spawn_egg_${kind}`, stack: 64, spawns: kind };
  // An egg, lit from the top left, speckled with the second colour.
  icons[`spawn_egg_${kind}`] = (kit) => {
    const c = new kit.Canvas();
    const N = kit.N;
    const cx = N / 2;
    const egg = (x, y) => {
      const dy = (y - N * 0.56) / (N * 0.38);
      const w = N * (dy < 0 ? 0.26 : 0.3) * Math.sqrt(Math.max(0, 1 - dy * dy));
      return Math.abs(x - cx) <= w;
    };
    c.fill(0, egg, (x, y) => -((x - cx) / N + (y - N * 0.5) / N) * 0.8);
    let seed = id * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 9; k++) {
      const sx = cx + (rnd() - 0.5) * N * 0.42;
      const sy = N * 0.3 + rnd() * N * 0.55;
      const r = 1.2 + rnd() * 1.6;
      c.fill(1, (x, y) => egg(x, y) && (x - sx) ** 2 + (y - sy) ** 2 <= r * r);
    }
    return c.render([ramp(kit, shell), ramp(kit, spots)]);
  };
  // A right click on a block: the creature, standing on the side clicked.
  itemUse[id] = (ctx) => {
    const p = ctx.place;
    if (!p || typeof LIB.spawnMob !== "function") return false;
    const x = Array.isArray(p) ? p[0] : p.x;
    const y = Array.isArray(p) ? p[1] : p.y;
    const z = Array.isArray(p) ? p[2] : p.z;
    if (!Number.isFinite(x + y + z)) return false;
    LIB.spawnMob(kind, x + 0.5, y, z + 0.5, {});
    if (!ctx.creative) ctx.inventory.consumeSelected(1);
    return true;
  };
}
