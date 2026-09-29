// Laser bolts: short, glowing sci-fi blaster bolts that fly fast in a
// straight line. One shared system for every laser in the game: the
// player's blaster, enemy UFOs, aliens' laser guns and the player's own UFO
// cannon. Bolts are drawn as two instanced meshes (a white-hot core and a
// colored additive halo, both HDR so they bloom), so hundreds cost two draw
// calls. On impact they spark, flash, leave a scorch mark on blocks, and
// hurt whatever they hit.
//
// Targets are pluggable: anything can register a hit provider with
// raycast(origin, dir, maxDist, bolt) -> { distance, hit(bolt, point, dir) }
// (mobs, UFOs, the player, vehicles); the bolt hits the nearest one, unless
// provider.ignores(bolt) says the bolt passes it (a bolt never hits its own
// shooter).
import * as THREE from "three";
import { LAYER_FX } from "./layers.js";
import { effectsQuality } from "./effects.js";

export const LASER_COLORS = {
  red: new THREE.Color(5, 0.35, 0.25),
  green: new THREE.Color(0.45, 5, 0.6),
  blue: new THREE.Color(0.5, 1.4, 6),
  cyan: new THREE.Color(0.6, 4, 5),
  magenta: new THREE.Color(4.5, 0.5, 4.5),
  orange: new THREE.Color(5, 2, 0.3),
};

const MAX_BOLTS = 320;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();
const SMOKE0 = new THREE.Color(0.25, 0.24, 0.23);
const SMOKE1 = new THREE.Color(0.5, 0.5, 0.5);

export class LaserBolts {
  constructor({ scene, world, effects, decals, audio }) {
    this.world = world;
    this.effects = effects;
    this.decals = decals;
    this.audio = audio;
    this.bolts = [];
    this.providers = [];
    this.listener = null; // () => Vector3: where the player's ears are (sound)
    this.fired = 0; // stats / tests

    // A capsule-ish bolt along +Z, unit length and radius.
    const coreGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1).rotateX(Math.PI / 2);
    const haloGeo = new THREE.CylinderGeometry(1, 0.55, 1, 8, 1).rotateX(Math.PI / 2);
    this.core = new THREE.InstancedMesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), MAX_BOLTS);
    this.halo = new THREE.InstancedMesh(
      haloGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }),
      MAX_BOLTS
    );
    for (const mesh of [this.core, this.halo]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOLTS * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.layers.set(LAYER_FX);
      scene.add(mesh);
    }
    this.halo.renderOrder = 13;
  }

  addProvider(provider) {
    this.providers.push(provider);
  }

  // Fires a bolt. opts: from (Vector3), dir (unit Vector3), color (Color,
  // HDR), speed (blocks/s), damage, owner (string: "player", "ufo", "alien",
  // "playerufo", ...), source (the object that fired it, which it never
  // hits), range (blocks), radius, length, scorch (leave a mark), sound.
  fire({ from, dir, color = LASER_COLORS.red, speed = 120, damage = 6, owner = "player", source = null, range = 220, radius = 0.06, length = 1.8, scorch = true, sound = true, blast = 0 }) {
    if (this.bolts.length >= MAX_BOLTS) this.bolts.shift();
    const bolt = {
      pos: from.clone(),
      dir: dir.clone().normalize(),
      color: color.clone ? color.clone() : new THREE.Color(color[0], color[1], color[2]),
      speed,
      damage,
      owner,
      source,
      range,
      traveled: 0,
      radius,
      length,
      scorch,
      blast,
      dead: false,
    };
    this.bolts.push(bolt);
    this.fired++;
    // A little muzzle glow.
    this.effects.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.08, size0: radius * 9, size1: radius * 3, color0: bolt.color, alpha: 0.9 });
    if (sound && this.audio?.playBlaster) {
      const ears = this.listener ? this.listener() : null;
      this.audio.playBlaster(ears ? from.distanceTo(ears) : 0, owner);
    }
    return bolt;
  }

  // The nearest thing (block or target) along a bolt's step, or null.
  _cast(b, step) {
    let best = null;
    const blockHit = this.world.raycast(b.pos, b.dir, step, { solidOnly: true });
    if (blockHit) best = { distance: blockHit.distance, block: blockHit };
    for (const p of this.providers) {
      if (p.ignores && p.ignores(b)) continue;
      const hit = p.raycast(b.pos, b.dir, best ? best.distance : step, b);
      if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, target: hit };
    }
    return best;
  }

  _impact(b, hit) {
    const point = b.pos.clone().addScaledVector(b.dir, hit.distance);
    const fx = this.effects;
    const q = effectsQuality.scale;
    const sparks = Math.max(3, Math.round(12 * q));
    const n = hit.block ? new THREE.Vector3(hit.block.normal[0], hit.block.normal[1], hit.block.normal[2]) : b.dir.clone().negate();
    for (let i = 0; i < sparks; i++) {
      const v = n.clone().multiplyScalar(2 + Math.random() * 5).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6));
      fx.glow.spawn({ x: point.x, y: point.y, z: point.z, vx: v.x, vy: v.y, vz: v.z, life: 0.2 + Math.random() * 0.3, size0: 0.09, size1: 0.02, color0: b.color, gravity: 0.5, drag: 2.5 });
    }
    fx.glow.spawn({ x: point.x, y: point.y, z: point.z, life: 0.14, size0: 0.9 + b.radius * 6, size1: 0.2, color0: b.color, alpha: 0.9 });
    fx.smoke.spawn({ x: point.x, y: point.y, z: point.z, vx: n.x * 0.6, vy: 0.6, vz: n.z * 0.6, life: 0.9, size0: 0.2, size1: 0.8, color0: SMOKE0, color1: SMOKE1, alpha: 0.4, drag: 1.5 });
    if (hit.block) {
      if (b.scorch && this.decals && this.world.getChunk(hit.block.block[0] >> 4, hit.block.block[2] >> 4)) this.decals.add(point, hit.block.block, hit.block.normal);
      const ears = this.listener ? this.listener() : null;
      if (this.audio?.playLaserHit) this.audio.playLaserHit(ears ? point.distanceTo(ears) : 0);
    } else if (hit.target) {
      hit.target.hit(b, point, b.dir);
    }
    if (b.blast > 0 && this.onBlast) this.onBlast(point, b);
  }

  update(dt) {
    const list = this.bolts;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const step = b.speed * dt;
      const hit = this._cast(b, step);
      if (hit) {
        this._impact(b, hit);
        continue;
      }
      b.pos.addScaledVector(b.dir, step);
      b.traveled += step;
      if (b.traveled > b.range || b.pos.y < -20 || b.pos.y > 400) continue;
      list[n++] = b;
    }
    list.length = n;
    // Draw: each bolt as a stretched core and halo trailing behind its head.
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const len = Math.min(b.length, b.traveled + 0.3);
      _q.setFromUnitVectors(_z, b.dir);
      _p.copy(b.pos).addScaledVector(b.dir, -len / 2);
      _m.compose(_p, _q, _s.set(b.radius, b.radius, len));
      this.core.setMatrixAt(i, _m);
      this.core.setColorAt(i, _c.copy(b.color).multiplyScalar(0.35).addScalar(1.1));
      _m.compose(_p, _q, _s.set(b.radius * 3.2, b.radius * 3.2, len * 1.15));
      this.halo.setMatrixAt(i, _m);
      this.halo.setColorAt(i, b.color);
    }
    this.core.count = n;
    this.halo.count = n;
    if (n > 0) {
      this.core.instanceMatrix.needsUpdate = true;
      this.core.instanceColor.needsUpdate = true;
      this.halo.instanceMatrix.needsUpdate = true;
      this.halo.instanceColor.needsUpdate = true;
    }
  }

  // Removes every bolt (e.g. mods switched off).
  clear() {
    this.bolts.length = 0;
    this.core.count = 0;
    this.halo.count = 0;
  }
}
