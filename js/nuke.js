// The nuclear bomb's detonation (dropped from the jet, see vehicle-jet.js):
// a blinding white flash, a fireball, a shockwave racing out over the
// ground, a mushroom cloud rising for half a minute, a huge crater, a
// scorched blast zone, and a boom heard (late, and muffled) from far away.
//
// Kept affordable: the crater is carved in slices over several frames (each
// slice one batched edit, so light and chunk rebuilds are spread out; the
// world rebuilds chunks on its own time budget), sand and gravel falling
// into it are capped by the falling-block system, and the cloud is a
// dedicated pool of large billboards whose count follows the intensity
// setting.
import * as THREE from "three";
import { BillboardPool } from "./particles.js";
import { makeCraterShape } from "./effects.js";
import { BLOCK, IS_LEAVES } from "./blocks.js";
import { LAYER_FX } from "./layers.js";
import { WORLD_HEIGHT } from "./constants.js";

export const NUKE_MIN_SIZE = 12;
export const NUKE_MAX_SIZE = 96;
export const NUKE_DEFAULTS = { size: 44, intensity: "high" };
const INTENSITY = { low: 0.4, medium: 0.7, high: 1 };
const SLICES_MIN = 10;

export class NukeSystem {
  constructor({ scene, world, effects, audio }) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.config = { ...NUKE_DEFAULTS };
    this.active = [];
    this.count = 0;
    this.listener = new THREE.Vector3();
    // A dedicated pool of big, slow cloud puffs.
    this.cloud = new BillboardPool(scene, 700, { additive: false });
    this.fire = new BillboardPool(scene, 260, { additive: true });
    // Fireball and shockwave meshes, reused.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false }));
    this.ball.layers.set(LAYER_FX);
    this.ball.visible = false;
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.4, 1.3), transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true }));
    this.shell.layers.set(LAYER_FX);
    this.shell.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true }));
    this.ring.layers.set(LAYER_FX);
    this.ring.visible = false;
    scene.add(this.ball, this.shell, this.ring);
    this.flashEl = document.getElementById("nuke-flash");
    this.onDetonate = null; // (center, radius) => void: damage (main.js)
    this._c = {
      hot: new THREE.Color(4, 3.4, 2.2),
      fire: new THREE.Color(3, 1.3, 0.35),
      fireEnd: new THREE.Color(0.7, 0.15, 0.03),
      litCloud: new THREE.Color(0.95, 0.5, 0.25),
      cloud: new THREE.Color(0.52, 0.49, 0.46),
      cloudDark: new THREE.Color(0.22, 0.2, 0.19),
      dust: new THREE.Color(0.55, 0.47, 0.38),
    };
  }

  get radius() {
    return Math.max(NUKE_MIN_SIZE, Math.min(NUKE_MAX_SIZE, this.config.size));
  }

  get intensity() {
    return INTENSITY[this.config.intensity] ?? 1;
  }

  detonate(center) {
    const R = this.radius;
    const d = {
      center: center.clone(),
      R,
      t: 0,
      slice: 0,
      shape: makeCraterShape(Math.max(0.75, R * 0.1)),
      removed: [],
      scorched: false,
      cloudT: 0,
      slices: Math.max(SLICES_MIN, Math.ceil(R / 4)), // the crater is carved in this many slices over frames
      height: Math.min(300, 50 + R * 3.8), // mushroom cap height above the ground
    };
    this.active.push(d);
    this.count++;
    const dist = center.distanceTo(this.listener);
    // The flash: blinding up close, still a white-out from far away.
    const flash = Math.max(0.25, Math.min(1, 1.6 - dist / 600));
    if (this.flashEl) {
      this.flashEl.style.transition = "none";
      this.flashEl.style.opacity = String(flash);
      void this.flashEl.offsetWidth;
      this.flashEl.style.transition = "opacity 2.8s ease-out";
      this.flashEl.style.opacity = "0";
    }
    this.effects.shake.add(Math.min(1, 1.3 - dist / 900));
    const fl = this.effects.flashLight;
    fl.position.copy(center).add(new THREE.Vector3(0, R * 0.5, 0));
    fl.distance = R * 12;
    this.effects._flashPower = 60000;
    this.effects._flashTime = 0;
    if (this.audio?.playNuke) this.audio.playNuke(dist, R);
    if (this.onDetonate) this.onDetonate(center, R);
    return d;
  }

  _carveSlice(d) {
    const c = d.center;
    const R = d.R;
    const x0 = Math.floor(c.x) - R - 2;
    const width = Math.ceil((2 * R + 5) / d.slices);
    const a = x0 + d.slice * width;
    const removed = this.effects._carve(c, R, { shape: d.shape, x0: a, x1: a + width - 1 });
    this.effects.floodInto(removed);
    d.slice++;
    // A sample of debris flying out.
    const fx = this.effects;
    const color = new THREE.Color();
    const step = Math.max(1, Math.floor(removed.length / 4 / (30 * this.intensity)));
    for (let i = 0; i < removed.length; i += step * 4) {
      const rgb = this.world.blockColors[removed[i + 3]] || [0.5, 0.5, 0.5];
      color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      const dx = removed[i] + 0.5 - c.x;
      const dz = removed[i + 2] + 0.5 - c.z;
      const len = Math.hypot(dx, dz) || 1;
      const sp = 15 + Math.random() * 25;
      fx.debris.spawn(removed[i] + 0.5, removed[i + 1] + 0.5, removed[i + 2] + 0.5, (dx / len) * sp, 12 + Math.random() * 25, (dz / len) * sp, 0.3 + Math.random() * 0.4, color, 2 + Math.random() * 2);
    }
  }

  // Everything within 2R loses its grass, leaves and plants: a scorched,
  // flattened blast zone (a bounded number of columns per frame).
  _scorch(d, budget) {
    const w = this.world;
    const c = d.center;
    const R2 = d.R * 2;
    if (!d.scorchCols) {
      d.scorchCols = [];
      for (let x = Math.floor(c.x - R2); x <= Math.ceil(c.x + R2); x++) {
        for (let z = Math.floor(c.z - R2); z <= Math.ceil(c.z + R2); z++) {
          if ((x - c.x) ** 2 + (z - c.z) ** 2 <= R2 * R2) d.scorchCols.push(x, z);
        }
      }
      d.scorchI = 0;
    }
    const edits = [];
    let n = 0;
    while (d.scorchI < d.scorchCols.length && n < budget) {
      const x = d.scorchCols[d.scorchI++];
      const z = d.scorchCols[d.scorchI++];
      n++;
      if (!w.getChunk(x >> 4, z >> 4)) continue;
      for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
        const id = w.getBlock(x, y, z);
        if (id === BLOCK.AIR) continue;
        if (IS_LEAVES[id] || id === BLOCK.TALL_GRASS || id === BLOCK.FLOWER_RED || id === BLOCK.FLOWER_YELLOW || id === BLOCK.SNOW) {
          edits.push(x, y, z, BLOCK.AIR);
          continue;
        }
        if (id === BLOCK.GRASS) edits.push(x, y, z, BLOCK.DIRT);
        break;
      }
    }
    if (edits.length) w.setBlocks(edits);
    return d.scorchI >= d.scorchCols.length;
  }

  update(dt, listener) {
    if (listener) this.listener.copy(listener);
    this.cloud.update(dt);
    this.fire.update(dt);
    const k = this.intensity;
    let anyBall = false;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const d = this.active[i];
      d.t += dt;
      const c = d.center;
      const R = d.R;
      // Crater: one slice per frame.
      if (d.slice < d.slices) this._carveSlice(d);
      else if (!d.scorched) d.scorched = this._scorch(d, 900);
      // Fireball: swells, then cools and rises.
      const tb = d.t;
      if (tb < 6) {
        anyBall = true;
        const grow = Math.min(1, tb / 0.8);
        const rise = Math.max(0, tb - 1) * R * 0.25;
        this.ball.visible = true;
        this.ball.position.set(c.x, c.y + R * 0.2 + rise, c.z);
        this.ball.scale.setScalar(R * (0.25 + 0.6 * grow) * (1 + Math.max(0, tb - 1) * 0.08));
        const heat = Math.max(0, 1 - tb / 6);
        this.ball.material.color.setRGB(3 + heat * 5, 1.2 + heat * 4, 0.3 + heat * 3);
        this.ball.material.opacity = Math.min(1, heat * 1.6);
      }
      // Shockwave: a bright shell and a ring racing over the ground.
      if (tb < 3) {
        const s = R * (0.5 + tb * 2.2);
        this.shell.visible = true;
        this.shell.position.copy(c);
        this.shell.scale.setScalar(s);
        this.shell.material.opacity = 0.3 * (1 - tb / 3);
        this.ring.visible = true;
        this.ring.position.set(c.x, c.y + 0.5, c.z);
        this.ring.scale.setScalar(s * 1.3);
        this.ring.material.opacity = 0.9 * (1 - tb / 3);
      } else if (!this.active.some((o) => o.t < 3)) {
        this.shell.visible = false;
        this.ring.visible = false;
      }
      // The mushroom cloud: a dust skirt, a rising stem, and a billowing
      // cap that climbs, spreads and turns from glowing orange to grey.
      d.cloudT += dt;
      const rate = 0.045 / k;
      while (d.cloudT > rate && d.t < 22) {
        d.cloudT -= rate;
        const t = d.t;
        const capY = c.y + Math.min(d.height, 12 + t * d.height * 0.12);
        const lit = Math.max(0, 1 - t / 10);
        const col0 = lit > 0.3 ? this._c.litCloud : this._c.cloud;
        if (t < 3.5 && Math.random() < 0.5) {
          // Dust racing out along the ground.
          const a = Math.random() * Math.PI * 2;
          const sp = R * (0.9 + Math.random() * 0.8);
          this.cloud.spawn({ x: c.x + Math.cos(a) * R * 0.4, y: c.y + 1, z: c.z + Math.sin(a) * R * 0.4, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 3, vz: Math.sin(a) * sp, life: 6 + Math.random() * 6, size0: R * 0.3, size1: R * 0.9, color0: this._c.dust, color1: this._c.cloud, alpha: 0.55, drag: 0.7 });
        }
        // Stem.
        const sy = c.y + Math.random() * (capY - c.y);
        this.cloud.spawn({ x: c.x + (Math.random() - 0.5) * R * 0.35, y: sy, z: c.z + (Math.random() - 0.5) * R * 0.35, vx: 0, vy: 3 + Math.random() * 3, vz: 0, life: 10 + Math.random() * 8, size0: R * 0.25, size1: R * 0.45, color0: col0, color1: this._c.cloudDark, alpha: 0.5, drag: 0.3 });
        // Cap: a torus of puffs rolling outward.
        for (let j = 0; j < 2; j++) {
          const a = Math.random() * Math.PI * 2;
          const rr = R * (0.6 + Math.min(1.6, t * 0.12)) * (0.6 + Math.random() * 0.5);
          this.cloud.spawn({
            x: c.x + Math.cos(a) * rr, y: capY + (Math.random() - 0.3) * R * 0.5, z: c.z + Math.sin(a) * rr,
            vx: Math.cos(a) * 2.5, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * 2.5,
            life: 14 + Math.random() * 10, size0: R * 0.45, size1: R * 0.9, color0: col0, color1: this._c.cloud, alpha: 0.6, drag: 0.2,
          });
        }
        // Fire glowing inside the cap early on.
        if (lit > 0.2 && Math.random() < lit) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.random() * R * 0.7;
          this.fire.spawn({ x: c.x + Math.cos(a) * rr, y: capY - R * 0.1, z: c.z + Math.sin(a) * rr, vy: 2, life: 1.5, size0: R * 0.35, size1: R * 0.6, color0: this._c.fire, color1: this._c.fireEnd, alpha: 0.45 * lit, drag: 0.5 });
        }
      }
      if (d.t > 40 && d.slice >= d.slices && d.scorched) this.active.splice(i, 1);
    }
    if (!anyBall) this.ball.visible = false;
  }

  // The radius of the blast's damage (for tests / HUD).
  static damageRadius(R) {
    return R * 2;
  }
}


