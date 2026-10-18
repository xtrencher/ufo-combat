// What the player does with the mouse and the item in hand: mining blocks
// (timed by hardness and tool in survival, instant in creative) with a crack
// overlay, drops and tool wear; placing blocks (a torch on the side of a
// block hangs on it); eating food; opening chests (js/chests.js); dropping
// items (Q); creative pick-block (middle click).
// Melee attacks go through `entityTarget`, which the mob system provides.
// (Round 11) The content modules' block and item uses (BLOCK_USE, ITEM_USE)
// and a block's placeAs come first: see js/content/index.js. A content
// block may also take two cells (placeMore: a door's upper half, a bed's
// head; its halves go together, see watchAttached), merge with the block
// it is placed into (merge: a slab onto its other half), hang under a block
// (ceiling) or on a wall (support "wall" with a facing: ladders).
// (Round 11, magic) The held stack's enchantments (js/enchant.js): mining
// (Efficiency; Silk Touch and Fortune in the drops; Aqua Affinity against
// the Survival world's slower digging under water, vanilla's 5x), melee (Sharpness, Smite, Bane of Arthropods, Knockback, Fire
// Aspect, Looting: the last three the creatures' attack takes as extras),
// Unbreaking (the inventory's wear). Strength and Weakness change a blow's
// damage. Potions are drunk like food, in either world (Creative too, and
// there the bottle stays).
import * as THREE from "three";
import {
  BLOCK,
  BLOCK_INFO,
  BLOCK_LIMIT,
  IS_REPLACEABLE,
  IS_CHEST,
  ITEM_OF,
  SHAPE,
  SHAPE_OF,
  CHEST_BOX,
  isSupportedBy,
  isWallSupportedBy,
  wallTorch,
  chest,
} from "./blocks.js";
import { itemInfo, breakTime, blockDrops, canHarvest, maxStack } from "./items.js";
import { buildCrackStages } from "./itemtextures.js";
import { selectionBox } from "./world.js";
import { HOTBAR_SIZE, makeStack } from "./inventory.js";
import { SEA_LEVEL } from "./constants.js";
import { Chests } from "./chests.js";
import { BLOCK_USE, ITEM_USE } from "./content/index.js";
import { enchLevel, efficiencyBonus, meleeBonus } from "./enchant.js";
import { isVanilla } from "./worldtype.js";
import { GLASS_BOTTLE } from "./content/ids.js";

const REACH_SURVIVAL = 4.5;
const REACH_CREATIVE = 6;
const BREAK_DELAY = 0.25; // pause after breaking a block before the next one starts (survival)
const CREATIVE_BREAK_REPEAT = 0.22;
const PLACE_REPEAT = 0.22;
const ENTITY_REACH = 3.5; // mobs must be closer than blocks to hit (survival)
// (Worn by their own use only, not by mining or hitting: vanilla's.)
const OWN_USE_WEAR = new Set(["flint_and_steel", "fishing_rod", "shield"]);

function createOutline() {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
  const material = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7 });
  const outline = new THREE.LineSegments(edges, material);
  outline.visible = false;
  return outline;
}

function createCrackMesh() {
  const textures = buildCrackStages().map((canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  const material = new THREE.MeshBasicMaterial({
    map: textures[0],
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), material);
  mesh.visible = false;
  mesh.renderOrder = 5;
  return { mesh, textures };
}

// (Round 10) Wall torches hang on the block behind them: one whose wall goes
// pops off and drops a torch, like a standing torch losing its floor (which
// world.js handles). An edit that came from another player online pops it
// here too, without a drop (their game dropped it). (Round 11) Ladders hang
// on their wall the same way, a lantern under its block (`ceiling`), and the
// two halves of a door or a bed go together: when one goes, the other goes
// quietly (a `partner`: the other half's offset, `pairs`: whether a block
// there is that half), so breaking either drops one door or bed.
// (the four sides, then up and down)
const NEAR_X = [1, -1, 0, 0, 0, 0];
const NEAR_Y = [0, 0, 0, 0, 1, -1];
const NEAR_Z = [0, 0, 1, -1, 0, 0];
const ON_WALL = new Uint8Array(BLOCK_LIMIT);
const PAIRED = new Uint8Array(BLOCK_LIMIT);
const HANGING = new Uint8Array(BLOCK_LIMIT);
for (const info of Object.values(BLOCK_INFO)) {
  if (info.support === "wall" && info.facing) ON_WALL[info.id] = 1;
  if (info.partner && info.pairs) PAIRED[info.id] = 1;
  if (info.ceiling) HANGING[info.id] = 1;
}
function watchAttached(world) {
  world.changeListeners.push((changed, opts) => {
    let pop = null; // [x, y, z, id]: these drop what they are
    let quiet = null; // [x, y, z, id]: the other halves, gone without a drop
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const y = changed[i + 1];
      const z = changed[i + 2];
      const here = world.getBlock(x, y, z);
      const wall = isWallSupportedBy(here);
      for (let k = 0; k < 6; k++) {
        const dx = NEAR_X[k];
        const dy = NEAR_Y[k];
        const dz = NEAR_Z[k];
        const id = world.getBlock(x + dx, y + dy, z + dz);
        if (ON_WALL[id] && !wall && dy === 0) {
          const f = BLOCK_INFO[id].facing;
          if (f[0] === dx && f[1] === dz) (pop ||= []).push(x + dx, y, z + dz, id);
        }
        if (HANGING[id] && dy === -1 && !BLOCK_INFO[id].ceiling(here)) (pop ||= []).push(x, y - 1, z, id);
        if (PAIRED[id]) {
          const p = BLOCK_INFO[id].partner;
          if (dx + p[0] === 0 && dy + p[1] === 0 && dz + p[2] === 0 && !BLOCK_INFO[id].pairs(here)) (quiet ||= []).push(x + dx, y + dy, z + dz, BLOCK.AIR);
        }
      }
    }
    const remote = !!opts?.remote;
    const recordEdit = opts?.recordEdit !== false;
    if (quiet) world.setBlocks(quiet, { recordEdit, remote });
    if (!pop) return;
    const list = pop.slice();
    for (let i = 3; i < list.length; i += 4) list[i] = BLOCK.AIR;
    world.setBlocks(list, { recordEdit, remote });
    if (remote || !world.onBlockPopped) return;
    for (let i = 0; i < pop.length; i += 4) if (world.getBlock(pop[i], pop[i + 1], pop[i + 2]) === BLOCK.AIR) world.onBlockPopped(pop[i], pop[i + 1], pop[i + 2], pop[i + 3]);
  });
}

export class Interaction {
  constructor({ scene, world, player, inventory, entities, audio, effects, held }) {
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.entities = entities;
    this.audio = audio;
    this.effects = effects;
    this.held = held;

    this.outline = createOutline();
    scene.add(this.outline);
    const crack = createCrackMesh();
    this.crackMesh = crack.mesh;
    this.crackTextures = crack.textures;
    scene.add(this.crackMesh);

    this.target = null; // block raycast hit
    this.leftDown = false;
    this.rightDown = false;
    this.mining = null; // { x, y, z, id, progress, time }
    this._breakCooldown = 0;
    this._placeTimer = 0;
    this._digSoundTimer = 0;
    this.eating = 0; // seconds spent eating the held food (0 = not eating)
    this._eatSoundTimer = 0;
    this._color = new THREE.Color();

    watchAttached(world);
    // The chests' contents (and what a broken one spills).
    this.chests = new Chests({ world });
    this.chests.onDrop = (s, x, y, z) => {
      const vel = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
      this.entities.spawn(s.id, s.count, new THREE.Vector3(x + 0.5, y + 0.4, z + 0.5), vel, { dur: s.dur, tag: s.tag, pickupDelay: 0.6 });
    };
    this.onOpenChest = null; // (x, y, z): right click on a chest (main.js opens the chest screen)

    // Hooks set by the game.
    this.onChange = null; // () => void: inventory contents changed
    // The mob system (raycast, attack, charge, swing, overlapsBlock), if any.
    this.combat = null;
    this.othersOverlap = null; // (bx, by, bz) => whether the block would be inside another player (online)
    this.weapons = null; // the weapon system (grenades, pistol, bazooka), if any
    this.entityHit = null; // { mob, distance } under the crosshair
    this.onUseMob = null; // (mob, stack) => true if a right click on the creature was handled (Round 11)
  }

  get reach() {
    return this.player.creative ? REACH_CREATIVE : REACH_SURVIVAL;
  }

  _tool() {
    const s = this.inventory.selectedStack;
    const tool = s ? itemInfo(s.id)?.tool ?? null : null;
    // (A bow's `tool` is only its uses, worn by its shots: it hits and mines as a bare hand.)
    return tool?.type === "bow" ? null : tool;
  }

  // The held tool's info (null for the bare hand or a non-tool item).
  get tool() {
    return this._tool();
  }

  _changed() {
    if (this.onChange) this.onChange();
  }

  // ---------- Input ----------

  mouseDown(button) {
    if (button === 0) {
      this.leftDown = true;
      this._breakCooldown = 0;
      this._primary();
    } else if (button === 2) {
      this.rightDown = true;
      this._placeTimer = 0;
      // (Round 11) Right click on a creature with something in hand (shears on
      // a sheep, a bucket on a cow, wheat to breed, a villager's trades): the
      // creatures' own handler (mobs.js), if it takes it.
      if (this.entityHit && this.onUseMob?.(this.entityHit.mob, this.inventory.selectedStack)) {
        this.held.swing();
        this._changed();
        return;
      }
      const t = this.target;
      // A content block's own use (a door, a bed, a furnace), unless the
      // player sneaks with something in hand (that places against it).
      if (t && BLOCK_USE[t.id] && !(this.player.sneaking && this.inventory.selectedStack) && BLOCK_USE[t.id](this._useCtx(t))) {
        this.held.swing();
        this._changed();
        return;
      }
      // A chest under the crosshair opens, whatever is in hand.
      if (t && IS_CHEST[t.id] && this.onOpenChest) {
        this.audio.playClick?.();
        this.onOpenChest(t.block[0], t.block[1], t.block[2]);
        return;
      }
      // A weapon or grenade in hand is used instead of placing or opening;
      // a piece of armor in hand is put on.
      const weapon = this._weapon();
      if (this._wearArmor()) return;
      if (weapon && this.weapons) this.weapons.press(weapon.kind);
      else this._use();
    } else if (button === 1) {
      this._pickBlock();
    }
  }

  mouseUp(button) {
    if (button === 0) {
      this.leftDown = false;
      this._stopMining();
    } else if (button === 2) {
      this.rightDown = false;
      this.eating = 0;
      if (this.weapons) this.weapons.release();
    }
  }

  // Right click with a piece of armor in hand puts it on (swapping with the
  // piece worn in that slot). True if it did.
  _wearArmor() {
    const stack = this.inventory.selectedStack;
    const armor = stack ? itemInfo(stack.id)?.armor : null;
    if (!armor || !this.inventory.equipSelectedArmor()) return false;
    this.audio.playClick?.();
    this.onMessage?.(`Wearing the ${itemInfo(stack.id).name}`);
    this._changed();
    return true;
  }

  release() {
    this.leftDown = false;
    this.rightDown = false;
    this.eating = 0;
    this._stopMining();
    if (this.weapons) this.weapons.cancel();
  }

  // The selected item's weapon info ({ kind }), or null.
  _weapon() {
    const s = this.inventory.selectedStack;
    return s ? itemInfo(s.id)?.weapon ?? null : null;
  }

  // Q: throw one of the held item (the whole stack with Ctrl).
  dropSelected(all) {
    const s = this.inventory.selectedStack;
    if (!s) return;
    const dropped = this.inventory.consumeSelected(all ? s.count : 1);
    this.throwStack(dropped);
    this.held.swing();
    this._changed();
  }

  // Throws a stack out in front of the player.
  throwStack(stack) {
    if (!stack) return;
    const eye = this.player.getEyePosition();
    const dir = this.player.getForwardVector();
    const pos = eye.clone().addScaledVector(dir, 0.4);
    pos.y -= 0.35;
    const vel = dir.clone().multiplyScalar(5.5);
    vel.y += 1.8;
    this.entities.spawn(stack.id, stack.count, pos, vel, { dur: stack.dur, tag: stack.tag, pickupDelay: 1.6 });
  }

  // ---------- Targeting ----------

  updateTarget(active) {
    if (!active) {
      this.target = null;
      this.outline.visible = false;
      this.crackMesh.visible = false;
      return;
    }
    const origin = this.player.getEyePosition();
    const dir = this.player.getForwardVector();
    this.target = this.world.raycast(origin, dir, this.reach);
    if (this.target) this._faceHit(this.target, origin, dir);
    // A mob in front of the block takes the crosshair.
    this.entityHit = this.combat ? this.combat.raycast(origin, dir, this.player.creative ? 5 : ENTITY_REACH) : null;
    if (this.entityHit && this.target && this.target.distance < this.entityHit.distance) this.entityHit = null;
    if (this.entityHit) this.target = null;

    if (this.target) {
      const [bx, by, bz] = this.target.block;
      const box = selectionBox(this.target.id);
      this.outline.scale.set(box[3] - box[0], box[4] - box[1], box[5] - box[2]);
      this.outline.position.set(bx + (box[0] + box[3]) / 2, by + (box[1] + box[4]) / 2, bz + (box[2] + box[5]) / 2);
      this.outline.visible = true;
    } else {
      this.outline.visible = false;
    }
  }

  // (Round 11) The face of a shaped block's box the crosshair is on, and the
  // cell beyond it. (The ray cast names the face of the cell it came in
  // through: from a low angle a slab's top would read as its side, and a
  // slab placed there would go beside it instead of onto it.)
  _faceHit(t, origin, dir) {
    if (SHAPE_OF[t.id] === SHAPE.CUBE || t.distance <= 0) return;
    const box = selectionBox(t.id);
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = [dir.x / len, dir.y / len, dir.z / len];
    const p = [origin.x + d[0] * t.distance - t.block[0], origin.y + d[1] * t.distance - t.block[1], origin.z + d[2] * t.distance - t.block[2]];
    let axis = -1;
    let sign = 0;
    for (let a = 0; a < 3; a++) {
      const s = d[a] < 0 && Math.abs(p[a] - box[a + 3]) < 1e-3 ? 1 : d[a] > 0 && Math.abs(p[a] - box[a]) < 1e-3 ? -1 : 0;
      if (!s) continue;
      // (on an edge: the face the cell was entered through, else the one faced most squarely)
      if (axis < 0 || t.normal[a] === s || (t.normal[axis] !== sign && Math.abs(d[a]) > Math.abs(d[axis]))) {
        axis = a;
        sign = s;
      }
    }
    if (axis < 0 || t.normal[axis] === sign) return;
    const n = [0, 0, 0];
    n[axis] = sign;
    t.normal = n;
    t.place = [t.block[0] + n[0], t.block[1] + n[1], t.block[2] + n[2]];
  }

  // ---------- Left button: attack / mine ----------

  _primary() {
    // The sniper fires on left click instead of mining/melee (right click
    // toggles its scope, like the other weapons' right-click use).
    const weapon = this._weapon();
    if (weapon && weapon.kind === "sniper" && this.weapons) {
      this.weapons.sniperShot();
      return;
    }
    this.held.swing();
    if (this.entityHit) {
      const tool = this._tool();
      const mob = this.entityHit.mob;
      const extra = this._meleeExtras(mob, tool);
      const landed = this.combat.attack(mob, extra.tool, extra);
      if (landed) this.onAttack?.(); // (Round 11: a hit's hunger, main.js)
      if (landed && tool && !this.player.creative && !OWN_USE_WEAR.has(tool.type)) {
        // Weapons wear with use: swords by 1 per hit, other tools by 2.
        if (this.inventory.damageSelected(tool.type === "sword" ? 1 : 2)) this.audio.playToolBreak();
        this._changed();
      }
      return;
    }
    if (this.target) {
      // A swing at the ground cuts the plants around the spot.
      this.onCut?.(this.target.block[0], this.target.block[1], this.target.block[2], this.target.normal);
      this._startMining();
    } else if (this.combat) {
      this.combat.swing();
      this.audio.playSwing();
    }
  }

  // (Round 11) A blow's enchantments and effects: the tool with its extra
  // damage (Sharpness, Smite, Bane; Strength +3, Weakness -4 a level), and
  // for the creatures' attack the bare hand's extra damage, Knockback, Fire
  // Aspect (seconds of fire) and Looting.
  _meleeExtras(mob, tool) {
    const stack = this.inventory.selectedStack;
    const p = this.player;
    const ench = stack?.tag?.ench ? stack : null;
    let bonus = ench && tool ? meleeBonus(stack, mob?.kind) : 0;
    bonus += 3 * (p.effectLevel?.("strength") ?? 0) - 4 * (p.effectLevel?.("weakness") ?? 0);
    const out = { tool, bonus: 0, knockback: 0, fire: 0, looting: 0 };
    if (bonus) {
      if (tool) out.tool = { ...tool, damage: Math.max(0, tool.damage + bonus) };
      else out.bonus = bonus;
    }
    if (ench && tool) {
      out.knockback = enchLevel(stack, "knockback");
      out.fire = 4 * enchLevel(stack, "fire_aspect");
      out.looting = enchLevel(stack, "looting");
    }
    return out;
  }

  // The seconds to mine block `id` now: the tool and its Efficiency; in a
  // Survival world vanilla's 5x with the head under water (unless the
  // helmet has Aqua Affinity) and another 5x off the ground (on a ladder,
  // mid-jump, swimming, in a cobweb).
  _breakTime(id) {
    const stack = this.inventory.selectedStack;
    let t = breakTime(id, this._tool(), stack?.tag ? efficiencyBonus(stack) : 0);
    if (!isVanilla() || !Number.isFinite(t) || t <= 0) return t;
    const p = this.player;
    if (p.headInWater && !enchLevel(this.inventory.armor?.[0], "aqua_affinity")) t *= 5;
    if (!p.onGround && !p.flying) t *= 5;
    return t;
  }

  _startMining() {
    const [x, y, z] = this.target.block;
    const id = this.world.getBlock(x, y, z);
    if (id === BLOCK.AIR) return;
    if (this.player.creative) {
      this._breakBlock(x, y, z, id, false);
      this._breakCooldown = CREATIVE_BREAK_REPEAT;
      return;
    }
    const time = this._breakTime(id);
    this.mining = { x, y, z, id, progress: 0, time };
    this._digSoundTimer = 0;
    if (time === 0) {
      this._breakBlock(x, y, z, id, true);
      this.mining = null;
      this._breakCooldown = BREAK_DELAY;
    }
  }

  _stopMining() {
    this.mining = null;
    this.crackMesh.visible = false;
  }

  _updateMining(dt) {
    if (!this.leftDown) return;
    const weapon = this._weapon();
    if (weapon && weapon.kind === "sniper") return; // one shot per click, not held-to-mine
    if (this._breakCooldown > 0) {
      this._breakCooldown -= dt;
      if (this._breakCooldown > 0) return;
    }
    if (this.entityHit) {
      // Holding the button against a mob swings again once fully recharged.
      this._stopMining();
      if (this.combat.charge(this._tool()) >= 1) this._primary();
      return;
    }
    if (!this.target) {
      this._stopMining();
      return;
    }
    const [x, y, z] = this.target.block;
    const m = this.mining;
    if (!m || m.x !== x || m.y !== y || m.z !== z || this.world.getBlock(x, y, z) !== m.id) {
      this._startMining();
      return;
    }
    if (!this.held.swinging) this.held.swing();
    // (Round 11: as vanilla, the speed of the moment: the head in the water or not.)
    m.time = this._breakTime(m.id);
    if (m.time === Infinity) return; // unbreakable (bedrock)
    m.progress += dt / m.time;
    this._digSoundTimer -= dt;
    if (this._digSoundTimer <= 0) {
      this._digSoundTimer = 0.24;
      this.audio.playDig(BLOCK_INFO[m.id].sound);
      this._hitParticles(x, y, z, m.id, this.target.normal, 2);
    }
    if (m.progress >= 1) {
      this._breakBlock(x, y, z, m.id, true);
      this._stopMining();
      this._breakCooldown = BREAK_DELAY;
    }
  }

  _breakBlock(x, y, z, id, survival) {
    const world = this.world;
    const tool = this._tool();
    if (!world.setBlock(x, y, z, BLOCK.AIR)) return;
    this.audio.playBreak(BLOCK_INFO[id].sound);
    this._hitParticles(x, y, z, id, null, 14);
    // A block mined next to the sea lets the water in.
    if (y <= SEA_LEVEL) this.effects.floodInto([x, y, z, id]);
    if (!survival) return;
    // (Round 11) Silk Touch and Fortune on the tool.
    const stack = this.inventory.selectedStack;
    const silk = !!tool && enchLevel(stack, "silk_touch") > 0;
    const fortune = tool ? enchLevel(stack, "fortune") : 0;
    for (const [itemId, count] of blockDrops(id, tool, Math.random, silk || fortune ? { silk, fortune } : null)) {
      this.entities.spawn(itemId, count, new THREE.Vector3(x + 0.5, y + 0.25, z + 0.5));
    }
    // (Round 11) Mining's hunger and an ore's XP (main.js, Survival worlds;
    // none for an ore taken whole with Silk Touch).
    this.onBlockBroken?.(x, y, z, id, tool, silk);
    if (tool && BLOCK_INFO[id].hardness > 0 && !OWN_USE_WEAR.has(tool.type)) {
      // (A Survival world's sword wears by 2 a block, as vanilla's.)
      if (this.inventory.damageSelected(tool.type === "sword" && isVanilla() ? 2 : 1)) this.audio.playToolBreak();
    }
    this._changed();
  }

  // Items dropped by blocks that break on their own (a torch whose wall was
  // mined, a flower whose soil was removed).
  blockPopped(x, y, z, id) {
    if (this.player.creative) return;
    // (A block that comes off on its own drops itself even where mining it
    // would take a pickaxe: a lantern whose ceiling went, an iron door.)
    const drops = canHarvest(id, null) ? blockDrops(id, null) : itemInfo(ITEM_OF[id]) ? [[ITEM_OF[id], 1]] : [];
    for (const [itemId, count] of drops) {
      this.entities.spawn(itemId, count, new THREE.Vector3(x + 0.5, y + 0.25, z + 0.5));
    }
  }

  _hitParticles(x, y, z, id, normal, count) {
    const rgb = this.world.blockColors[id] || [0.6, 0.6, 0.6];
    const c = this._color;
    const box = selectionBox(id);
    for (let i = 0; i < count; i++) {
      let px = x + box[0] + Math.random() * (box[3] - box[0]);
      let py = y + box[1] + Math.random() * (box[4] - box[1]);
      let pz = z + box[2] + Math.random() * (box[5] - box[2]);
      if (normal) {
        // Chips fly off the face being hit.
        if (normal[0]) px = x + (normal[0] > 0 ? 1.05 : -0.05);
        if (normal[1]) py = y + (normal[1] > 0 ? 1.05 : -0.05);
        if (normal[2]) pz = z + (normal[2] > 0 ? 1.05 : -0.05);
      }
      const shade = 0.7 + Math.random() * 0.4;
      c.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
      const n = normal || [0, 0, 0];
      this.effects.debris.spawn(
        px, py, pz,
        (Math.random() - 0.5) * 3 + n[0] * 2,
        Math.random() * 3 + 1 + n[1] * 2,
        (Math.random() - 0.5) * 3 + n[2] * 2,
        0.06 + Math.random() * 0.06,
        c,
        0.5 + Math.random() * 0.5
      );
    }
  }

  // ---------- Right button: use / place / eat ----------

  // What a content module's use handler or placeAs gets (js/content/index.js):
  // the block aimed at (t: a raycast hit, or null) and the cell a block
  // placed now would go to (place).
  _useCtx(t, place = t ? t.place : null) {
    const stack = this.inventory.selectedStack;
    const eye = this.player.getEyePosition();
    const f = this.player.getForwardVector();
    return {
      world: this.world,
      player: this.player,
      inventory: this.inventory,
      entities: this.entities,
      audio: this.audio,
      effects: this.effects,
      interaction: this,
      x: t ? t.block[0] : null,
      y: t ? t.block[1] : null,
      z: t ? t.block[2] : null,
      id: t ? t.id : null,
      normal: t ? t.normal : null,
      place,
      // (where the crosshair meets the block, and the view direction)
      hit: t ? [eye.x + f.x * t.distance, eye.y + f.y * t.distance, eye.z + f.z * t.distance] : null,
      forward: [f.x, f.y, f.z],
      stack,
      info: stack ? itemInfo(stack.id) : null,
      creative: !!this.player.creative,
      sneaking: !!this.player.sneaking,
    };
  }

  // Returns true if the item in hand did something (eat, place).
  _use() {
    const stack = this.inventory.selectedStack;
    const info = stack ? itemInfo(stack.id) : null;
    // A content item's own use (a bucket, a hoe, bone meal).
    if (stack && ITEM_USE[stack.id] && ITEM_USE[stack.id](this._useCtx(this.target))) {
      this.held.swing();
      this._changed();
      return true;
    }
    // (Round 11) A potion: drunk whenever (vanilla), in either world.
    if (info?.potion && !info.splash) {
      if (this.player.dead) return false;
      this.eating = 0.0001;
      return true;
    }
    if (info?.food) {
      // (Round 11) A Survival world: when not full (or food that can always
      // be eaten, milk); a Missions world: when hurt (player.js canEat).
      if (this.player.canEat(info, stack.id)) {
        this.eating = 0.0001;
        return true;
      }
      return false;
    }
    if (info?.block) return this._place(stack.id);
    return false;
  }

  _place(blockId) {
    const t = this.target;
    if (!t) return false;
    if (IS_CHEST[t.id]) return false; // (right click opens it: nothing is placed against one)
    const world = this.world;
    // (Round 11) A slab onto its other half (or into a cell holding it) makes
    // the full block there: [x, y, z, id], or null.
    const merged = BLOCK_INFO[blockId].merge?.(this._useCtx(t)) || null;
    let px;
    let py;
    let pz;
    let more = null; // the other cells of a two-cell block: [x, y, z, id, ...]
    if (merged) {
      [px, py, pz, blockId] = merged;
    } else {
      // Placing onto something replaceable (tall grass) replaces it in place.
      [px, py, pz] = IS_REPLACEABLE[t.id] ? t.block : t.place;
      if (!IS_REPLACEABLE[world.getBlock(px, py, pz)]) return false;
      if (blockId === BLOCK.TORCH && !IS_REPLACEABLE[t.id]) {
        // A torch on the side of a block hangs on it, on top it stands, and
        // under a block it doesn't go (as in classic block games).
        const [nx, ny, nz] = t.normal;
        if (ny < 0) return false;
        if (ny === 0 && (nx || nz) && isWallSupportedBy(t.id)) blockId = wallTorch(nx, nz);
      } else if (IS_CHEST[blockId]) {
        // A chest's front (its latch) faces the player who places it.
        const f = this.player.getForwardVector();
        blockId = chest(-f.x, -f.z);
      } else if (BLOCK_INFO[blockId].placeAs) {
        // A content block picks its variant (facing, top or bottom half).
        const ctx = this._useCtx(t, [px, py, pz]);
        blockId = BLOCK_INFO[blockId].placeAs(ctx);
        if (!blockId || !BLOCK_INFO[blockId]) return false;
        if (BLOCK_INFO[blockId].placeMore) {
          more = BLOCK_INFO[blockId].placeMore(ctx, blockId, px, py, pz);
          if (!more) return false;
        }
      }
    }
    if (this._occupied(blockId, px, py, pz)) return false;
    if (more) for (let i = 0; i < more.length; i += 4) if (this._occupied(more[i + 3], more[i], more[i + 1], more[i + 2])) return false;
    if (!merged && !isSupportedBy(blockId, world.getBlock(px, py - 1, pz))) return false;
    if (!world.setBlocks(more ? [px, py, pz, blockId, ...more] : [px, py, pz, blockId]) || world.getBlock(px, py, pz) !== blockId) return false;
    this.audio.playPlace(BLOCK_INFO[blockId].sound);
    this.held.swing();
    if (!this.player.creative) this.inventory.consumeSelected(1);
    this._changed();
    return true;
  }

  // Whether a solid block placed at the cell would be inside a player or a creature.
  _occupied(id, x, y, z) {
    if (!BLOCK_INFO[id].solid) return false;
    return this._overlapsPlayer(x, y, z) || !!this.othersOverlap?.(x, y, z) || !!(this.combat && this.combat.overlapsBlock(x, y, z));
  }

  _overlapsPlayer(bx, by, bz) {
    const p = this.player.position;
    const r = 0.3;
    const overlapsXZ = bx + 1 > p.x - r && bx < p.x + r && bz + 1 > p.z - r && bz < p.z + r;
    const overlapsY = by + 1 > p.y && by < p.y + 1.8;
    return overlapsXZ && overlapsY;
  }

  _updateUse(dt) {
    if (!this.rightDown || this._weapon()) return; // weapons fire once per click
    const stack = this.inventory.selectedStack;
    const info = stack ? itemInfo(stack.id) : null;
    if (this.eating > 0) {
      const drink = !!info?.potion && !info.splash;
      if ((!info?.food && !drink) || (this.player.creative && !drink)) {
        this.eating = 0;
        return;
      }
      this.eating += dt;
      this._eatSoundTimer -= dt;
      if (this._eatSoundTimer <= 0) {
        this._eatSoundTimer = 0.21;
        if (drink || info.drink) this.audio.playDrink?.();
        else this.audio.playEat();
      }
      if (drink && this.eating >= 1.6) {
        // (Its effects through the player's own; the empty bottle back.)
        for (const e of info.potion.effects) this.player.addEffect(e.id, e.seconds, e.level);
        if (!this.player.creative) {
          this.inventory.consumeSelected(1);
          if (!this.inventory.selectedStack) this.inventory.slots[this.inventory.selected] = makeStack(GLASS_BOTTLE, 1);
          else if (this.inventory.add(GLASS_BOTTLE, 1) > 0) this.throwStack(makeStack(GLASS_BOTTLE, 1));
        }
        this.eating = 0;
        this._changed();
        return;
      }
      if (!drink && this.eating >= this.player.eatTime(info, stack.id)) {
        // (Round 11) player.eat: hunger, saturation and the food's effects in
        // a Survival world, health in a Missions world; milk clears effects.
        const back = this.player.eat(info, stack.id);
        this.inventory.consumeSelected(1);
        // (A stew's bowl, milk's bucket: back in the hand, or in the inventory.)
        if (back && itemInfo(back)) {
          if (!this.inventory.selectedStack) this.inventory.slots[this.inventory.selected] = makeStack(back, 1);
          else if (this.inventory.add(back, 1) > 0) this.throwStack(makeStack(back, 1));
        }
        this.eating = 0;
        this._changed();
      }
      return;
    }
    this._placeTimer += dt;
    if (this._placeTimer >= PLACE_REPEAT) {
      this._placeTimer = 0;
      this._use();
    }
  }

  // Creative: middle click puts the targeted block in the hotbar.
  _pickBlock() {
    if (!this.player.creative || !this.target) return;
    const id = ITEM_OF[this.target.id]; // (a wall torch: a torch)
    if (!itemInfo(id)) return;
    const inv = this.inventory;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (inv.slots[i] && inv.slots[i].id === id) {
        inv.selected = i;
        return;
      }
    }
    let slot = inv.selected;
    if (inv.slots[slot]) {
      const empty = inv.slots.slice(0, HOTBAR_SIZE).findIndex((s) => !s);
      if (empty >= 0) slot = empty;
    }
    inv.slots[slot] = makeStack(id, maxStack(id)); // (a bed 1, a sign 16)
    inv.selected = slot;
    this._changed();
  }

  // ---------- Per frame ----------

  update(dt) {
    this._updateMining(dt);
    this._updateUse(dt);

    // Crack overlay on the block being mined.
    const m = this.mining;
    const shape = m ? SHAPE_OF[m.id] : -1;
    if (m && m.progress > 0 && m.time !== Infinity && (shape === SHAPE.CUBE || shape === SHAPE.CHEST)) {
      const stage = Math.min(9, Math.floor(m.progress * 10));
      if (this.crackMesh.material.map !== this.crackTextures[stage]) {
        this.crackMesh.material.map = this.crackTextures[stage];
        this.crackMesh.material.needsUpdate = true;
      }
      // (A chest: the cracks on its smaller box.)
      const b = shape === SHAPE.CHEST ? CHEST_BOX : null;
      if (b) {
        this.crackMesh.scale.set(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
        this.crackMesh.position.set(m.x + (b[0] + b[3]) / 2, m.y + (b[1] + b[4]) / 2, m.z + (b[2] + b[5]) / 2);
      } else {
        this.crackMesh.scale.set(1, 1, 1);
        this.crackMesh.position.set(m.x + 0.5, m.y + 0.5, m.z + 0.5);
      }
      this.crackMesh.visible = true;
    } else {
      this.crackMesh.visible = false;
    }
  }

  // Progress of the block being mined (0-1), for tests and the HUD.
  get miningProgress() {
    return this.mining ? Math.min(1, this.mining.progress) : 0;
  }

  // Whether the held tool can harvest the targeted block (e.g. for hints).
  get canHarvestTarget() {
    return this.target ? canHarvest(this.target.id, this._tool()) : false;
  }
}
