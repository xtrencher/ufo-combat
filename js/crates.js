// Supply crates: now and then, in Survival, a crate drifts down on a parachute
// a little way from the player, trailing bright orange smoke that can be seen
// from far away. Walk up to it to open it: a standard weapon you don't have
// yet (pistol, grenades, machine gun, sniper rifle, bazooka,
// airstrike: by tier), golden apples (extra hearts), sometimes a tool, food.
// Crates are not saved (a reload just starts the wait for the next one).
import * as THREE from "three";
import { rollLoot } from "./progression.js";
import { itemInfo } from "./items.js";
import { SEA_LEVEL } from "./constants.js";
import { IS_SOLID, IS_WET } from "./blocks.js";

const FIRST_DELAY = [50, 80]; // seconds after starting a Survival game until the first crate
const INTERVAL = [170, 300]; // between crates
const FALL_SPEED = 5.5;
const OPEN_REACH = 2.8;
const LIFETIME = 900;
const CANOPY_R = 2.4;
const CANOPY_ARC = Math.PI / 2.4;
const CANOPY_Y = 4.6; // the canopy's height above the crate's centre
const RIM_R = CANOPY_R * Math.sin(CANOPY_ARC); // the rim the cords are tied to
const RIM_Y = CANOPY_Y + CANOPY_R * Math.cos(CANOPY_ARC) * 0.6;
const LAND_MARGIN = 4; // a drop needs dry land this far around // an unopened crate is taken away after this long

// Adds a box (centre, size, colour) to the arrays of a merged, vertex-coloured geometry.
function addBox(out, cx, cy, cz, sx, sy, sz, hex) {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const c = new THREE.Color(hex).convertSRGBToLinear();
  for (let i = 0; i < pos.count; i++) {
    out.pos.push(pos.getX(i) + cx, pos.getY(i) + cy, pos.getZ(i) + cz);
    out.nor.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    out.col.push(c.r, c.g, c.b);
  }
  g.dispose();
}

// The crate: a wooden box of planks with dark steel corner brackets, steel
// bands, a lighter lid and a white square with a red cross on every side.
// Y runs from -0.6 (bottom) to 0.6 (top); the four lifting eyes the cords
// are tied to stand on the top corners (see EYES).
const CRATE_W = 1.5;
const EYES = [[-0.62, -0.62], [0.62, -0.62], [0.62, 0.62], [-0.62, 0.62]];
function crateGeometry() {
  const o = { pos: [], nor: [], col: [] };
  const H = CRATE_W / 2;
  addBox(o, 0, 0, 0, CRATE_W, 1.2, CRATE_W, 0xb98232); // the planks
  // Plank seams: darker thin strips around the sides.
  for (let k = -2; k <= 2; k++) {
    const y = k * 0.22;
    addBox(o, 0, y, 0, CRATE_W + 0.012, 0.018, CRATE_W + 0.012, 0x7a5320);
  }
  addBox(o, 0, 0.6, 0, CRATE_W - 0.1, 0.05, CRATE_W - 0.1, 0xd29a40); // the lid, lighter
  // Steel brackets on every vertical edge and bands around the top and bottom.
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(o, sx * (H - 0.04), 0, sz * (H - 0.04), 0.1, 1.24, 0.1, 0x3a3f46);
  for (const y of [-0.5, 0.5]) {
    addBox(o, 0, y, 0, CRATE_W + 0.03, 0.12, CRATE_W + 0.03, 0x4a5058);
  }
  // The marking: a white plate with a red cross on each side.
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const px = nx * (H + 0.012);
    const pz = nz * (H + 0.012);
    const sx = nx ? 0.02 : 0.5;
    const sz = nz ? 0.02 : 0.5;
    addBox(o, px, 0, pz, sx, 0.5, sz, 0xf0ece0);
    const qx = nx * (H + 0.024);
    const qz = nz * (H + 0.024);
    addBox(o, qx, 0, qz, nx ? 0.02 : 0.34, 0.1, nz ? 0.02 : 0.34, 0xc0261c);
    addBox(o, qx, 0, qz, nx ? 0.02 : 0.1, 0.34, nz ? 0.02 : 0.1, 0xc0261c);
  }
  // The lifting eyes on the top corners (where the cords are tied).
  for (const [ex, ez] of EYES) addBox(o, ex, 0.68, ez, 0.12, 0.12, 0.12, 0x23272c);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(o.pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(o.nor, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(o.col, 3));
  return geo;
}

export class SupplyCrates {
  constructor({ scene, world, player, effects, audio, inventory, entities, progress, stats }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.effects = effects;
    this.audio = audio;
    this.inventory = inventory;
    this.entities = entities;
    this.getTier = () => 0;
    this.randomAllowed = () => true; // Survival: crates drop by themselves once the chain has had its first one
    this.progress = progress;
    this.stats = stats;
    this.crates = [];
    this.enabled = false; // Survival with mods on
    this.timer = FIRST_DELAY[0] + Math.random() * (FIRST_DELAY[1] - FIRST_DELAY[0]);
    this.onMessage = null; // (text) => void
    this.onOpen = null; // (items) => void
    this._geo = crateGeometry();
    this._mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this._smoke = [new THREE.Color(2.4, 1.0, 0.25), new THREE.Color(1.6, 0.55, 0.15)];
    this._grey = [new THREE.Color(0.7, 0.35, 0.12), new THREE.Color(0.55, 0.5, 0.48)];
    // A striped canopy (orange and white), like the vehicle parachute.
    const canopy = new THREE.SphereGeometry(CANOPY_R, 16, 6, 0, Math.PI * 2, 0, CANOPY_ARC).scale(1, 0.6, 1);
    const pos = canopy.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const stripe = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 10) % 2 === 0;
      colors.set(stripe ? [1, 0.45, 0.12] : [0.95, 0.93, 0.88], i * 3);
    }
    canopy.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this._canopyGeo = canopy;
    this._canopyMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  }

  get active() {
    return this.crates.filter((c) => c.state !== "gone");
  }

  // Sends a crate down near the player. opts.dist: how far (blocks).
  drop(opts = {}) {
    const p = this.player.position;
    const site = this._findLand(p, opts.dist ?? 55 + Math.random() * 60);
    if (!site) return null; // all water around: no drop
    const { x, z } = site;
    const g = this.world.heightAt(Math.floor(x), Math.floor(z));
    const y = Math.min(300, Math.max(g, p.y) + 130);
    const group = new THREE.Group();
    const box = new THREE.Mesh(this._geo, this._mat);
    box.castShadow = true;
    const canopy = new THREE.Mesh(this._canopyGeo, this._canopyMat);
    canopy.position.y = CANOPY_Y;
    group.add(box, canopy);
    // Cords: from each lifting eye on the crate up to two points on the
    // canopy's rim (eight cords), so the crate hangs from the parachute.
    const pts = [];
    EYES.forEach(([ex, ez], i) => {
      for (const da of [-1, 1]) {
        const ang = Math.atan2(ez, ex) + da * 0.4;
        pts.push(ex, 0.74, ez, Math.cos(ang) * RIM_R, RIM_Y, Math.sin(ang) * RIM_R);
      }
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const cords = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2a2a }));
    cords.name = "cords";
    group.add(cords);
    group.position.set(x, y, z);
    this.scene.add(group);
    const crate = { pos: new THREE.Vector3(x, y, z), group, canopy, cords, state: "falling", age: 0, smokeT: 0, x, z, sway: Math.random() * 6 };
    this.crates.push(crate);
    this.onMessage?.("SUPPLY CRATE dropping nearby! Follow the orange smoke.");
    this.audio?.playSupply?.();
    return crate;
  }

  // Dry land: the ground is above the sea all around the spot (a drop must
  // never come down in the water or on a shore that floods).
  _isLand(x, z) {
    const w = this.world;
    for (const [dx, dz] of [[0, 0], [LAND_MARGIN, 0], [-LAND_MARGIN, 0], [0, LAND_MARGIN], [0, -LAND_MARGIN], [LAND_MARGIN, LAND_MARGIN], [-LAND_MARGIN, -LAND_MARGIN]]) {
      const h = w.heightAt(Math.floor(x + dx), Math.floor(z + dz));
      if (h < SEA_LEVEL + 1) return false;
    }
    const top = this._surface(x, z);
    const id = w.getBlock(Math.floor(x), top - 1, Math.floor(z));
    return IS_SOLID[id] === 1 && !IS_WET[w.getBlock(Math.floor(x), top, Math.floor(z))];
  }

  // A drop point near `dist` blocks from p on solid ground: tries a ring of
  // directions, then wider rings.
  _findLand(p, dist) {
    for (let ring = 0; ring < 5; ring++) {
      const d = dist * (1 + ring * 0.45);
      const a0 = Math.random() * Math.PI * 2;
      for (let k = 0; k < 16; k++) {
        const a = a0 + (k / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * d;
        const z = p.z + Math.sin(a) * d;
        if (this._isLand(x, z)) return { x, z };
      }
    }
    return null;
  }

  _surface(x, z) {
    const s = this.world.surfaceY(Math.floor(x), Math.floor(z));
    return s >= 0 ? s + 1 : this.world.heightAt(Math.floor(x), Math.floor(z)) + 1;
  }

  update(dt) {
    const pl = this.player;
    const fx = this.effects;
    if (this.enabled && !pl.dead && !pl.creative && this.randomAllowed()) {
      this.timer -= dt;
      if (this.timer <= 0 && this.active.length === 0) {
        this.timer = INTERVAL[0] + Math.random() * (INTERVAL[1] - INTERVAL[0]);
        this.drop();
      }
    }
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.age += dt;
      const t = c.age;
      if (c.state === "falling") {
        c.pos.y -= FALL_SPEED * dt;
        c.pos.x = c.x + Math.sin(t * 0.7 + c.sway) * 1.5;
        c.pos.z = c.z + Math.cos(t * 0.6 + c.sway) * 1.5;
        const ground = this._surface(c.pos.x, c.pos.z);
        if (c.pos.y <= ground + 0.6) {
          c.pos.y = ground + 0.6;
          c.state = "landed";
          c.canopy.visible = false;
          c.cords.visible = false;
          // The canopy sinks in a soft puff.
          for (let k = 0; k < 10; k++) fx.smoke.spawn({ x: c.pos.x, y: c.pos.y + 1, z: c.pos.z, vx: (Math.random() - 0.5) * 3, vy: 1, vz: (Math.random() - 0.5) * 3, life: 1.6, size0: 0.8, size1: 3, color0: this._grey[1], color1: this._grey[1], alpha: 0.5, drag: 1.5 });
        }
        c.group.rotation.z = Math.sin(t * 0.8) * 0.06;
        c.canopy.rotation.x = Math.sin(t * 0.9) * 0.05;
      }
      c.group.position.copy(c.pos);
      // Orange smoke, a column that lasts until the crate is opened.
      c.smokeT -= dt;
      if (c.smokeT <= 0 && c.state !== "gone") {
        c.smokeT = 0.09;
        const top = c.state === "falling" ? c.pos.y + 1 : c.pos.y + 0.8;
        fx.smoke.spawn({ x: c.pos.x, y: top, z: c.pos.z, vx: (Math.random() - 0.5) * 0.6, vy: 5 + Math.random() * 3, vz: (Math.random() - 0.5) * 0.6, life: 7 + Math.random() * 3, size0: 0.9, size1: 5.5, color0: this._smoke[0], color1: this._grey[1], alpha: 0.85, drag: 0.15 });
        if (Math.random() < 0.5) fx.glow.spawn({ x: c.pos.x, y: c.pos.y + 1.2, z: c.pos.z, life: 0.2, size0: 1.6, size1: 0.6, color0: this._smoke[0], alpha: 0.8 });
      }
      // Opening: walk up to it (or stand on it).
      if (c.state === "landed" && !pl.dead) {
        const d = Math.hypot(pl.position.x - c.pos.x, pl.position.z - c.pos.z);
        if (d < OPEN_REACH && Math.abs(pl.position.y - c.pos.y) < 4) this._open(c);
      }
      if (c.state === "landed" && c.age > LIFETIME) {
        c.state = "gone";
      }
      if (c.state === "gone") {
        this.scene.remove(c.group);
        this.crates.splice(i, 1);
      }
    }
  }

  _open(c) {
    c.state = "gone";
    const owned = new Set();
    for (const s of this.inventory.slots) if (s) owned.add(s.id);
    for (const a of this.inventory.armor) if (a) owned.add(a.id);
    const loot = rollLoot("crate", null, this.getTier(), owned);
    // A burst of light and sparks; the items go straight into the inventory
    // (or fall at your feet if it is full).
    for (let i = 0; i < 14; i++) this.effects.glow.spawn({ x: c.pos.x, y: c.pos.y + 0.8, z: c.pos.z, vx: (Math.random() - 0.5) * 8, vy: 2 + Math.random() * 6, vz: (Math.random() - 0.5) * 8, life: 0.6, size0: 0.5, size1: 0.1, color0: this._smoke[0], gravity: 0.8, drag: 1 });
    this.audio?.playCrate?.();
    const names = [];
    for (const [id, n] of loot) {
      const left = this.inventory.add(id, n);
      if (left > 0) this.entities.spawn(id, left, new THREE.Vector3(c.pos.x, c.pos.y + 1, c.pos.z));
      names.push(`${n > 1 ? `${n} x ` : ""}${itemInfo(id)?.name ?? "item"}`);
    }
    this.stats?.add("cratesOpened");
    this.onMessage?.(`Supply crate: ${names.join(", ")}`);
    this.onOpen?.(loot);
  }

  clear() {
    for (const c of this.crates) this.scene.remove(c.group);
    this.crates.length = 0;
  }

  // The nearest crate to a point: { crate, dist, dx, dz } or null (for the HUD).
  nearest(x, z) {
    let best = null;
    for (const c of this.crates) {
      if (c.state === "gone") continue;
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (!best || d < best.dist) best = { crate: c, dist: d, dx: c.pos.x - x, dz: c.pos.z - z };
    }
    return best;
  }
}
