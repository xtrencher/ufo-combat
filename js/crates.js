// Supply crates: now and then, in Survival, a crate drifts down on a parachute
// a little way from the player, trailing bright orange smoke that can be seen
// from far away. Walk up to it to open it: a standard weapon you don't have
// yet (pistol, grenades, machine gun, shield, sniper rifle, bazooka,
// airstrike: by tier), golden apples (extra hearts), sometimes a tool, food.
// Crates are not saved (a reload just starts the wait for the next one).
import * as THREE from "three";
import { rollLoot } from "./progression.js";
import { itemInfo } from "./items.js";

const FIRST_DELAY = [50, 80]; // seconds after starting a Survival game until the first crate
const INTERVAL = [170, 300]; // between crates
const FALL_SPEED = 5.5;
const OPEN_REACH = 2.8;
const LIFETIME = 900; // an unopened crate is taken away after this long

function crateGeometry() {
  const box = new THREE.BoxGeometry(1.5, 1.2, 1.5);
  const count = box.getAttribute("position").count;
  const col = new Float32Array(count * 3);
  const c = new THREE.Color(0xc88a2c).convertSRGBToLinear();
  for (let i = 0; i < count; i++) col.set([c.r, c.g, c.b], i * 3);
  box.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return box;
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
    const canopy = new THREE.SphereGeometry(2.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.4).scale(1, 0.6, 1);
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
    const dist = opts.dist ?? 55 + Math.random() * 60;
    const a = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(a) * dist;
    const z = p.z + Math.sin(a) * dist;
    const g = this.world.heightAt(Math.floor(x), Math.floor(z));
    const y = Math.min(300, Math.max(g, p.y) + 130);
    const group = new THREE.Group();
    const box = new THREE.Mesh(this._geo, this._mat);
    box.castShadow = true;
    const canopy = new THREE.Mesh(this._canopyGeo, this._canopyMat);
    canopy.position.y = 4.6;
    group.add(box, canopy);
    // Cords from the crate's top corners to the canopy's rim.
    const pts = [];
    for (const [cx, cz] of [[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]]) pts.push(cx, 0.6, cz, cx * 2.9, 4.4, cz * 2.9);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const cords = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x333333 }));
    group.add(cords);
    group.position.set(x, y, z);
    this.scene.add(group);
    const crate = { pos: new THREE.Vector3(x, y, z), group, canopy, state: "falling", age: 0, smokeT: 0, x, z, sway: Math.random() * 6 };
    this.crates.push(crate);
    this.onMessage?.("SUPPLY CRATE dropping nearby! Follow the orange smoke.");
    this.audio?.playSupply?.();
    return crate;
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
          c.group.children[2].visible = false;
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
    if (this.inventory.offhand) owned.add(this.inventory.offhand.id);
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
