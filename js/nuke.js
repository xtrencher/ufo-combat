// The nuclear bomb's detonation (dropped from the jet, see vehicle-jet.js):
// a blinding white flash, a fireball, a shockwave racing out over the
// ground, a mushroom cloud rising for over a minute (a swirling stem, a
// rolling cap that spreads and turns from glowing orange to grey, a white
// condensation ring racing out of the blast and a collar under the cap), a
// huge crater, a scorched blast zone, and a boom heard (late, and muffled)
// from far away.
//
// Kept affordable: the crater is carved in slices over several frames (each
// slice one batched edit, so light and chunk rebuilds are spread out; the
// world rebuilds chunks on its own time budget), sand and gravel falling
// into it are capped by the falling-block system, and the cloud is a
// dedicated pool of large billboards whose count follows the intensity
// setting and the effects quality of the graphics preset (fewer, bigger puffs
// on the lower presets).
import * as THREE from "three";
import { BillboardPool } from "./particles.js";
import { makeCraterShape, effectsQuality } from "./effects.js";
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
    this.cloud = new BillboardPool(scene, 1700, { additive: false, fog: false }); // (no distance fog: the cloud is seen from far beyond the view distance)
    this.fire = new BillboardPool(scene, 360, { additive: true, fog: false });
    this.daylight = 1;
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
    this._buildCloud(d);
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

  // ---------- The mushroom cloud ----------

  // Every puff of the cloud, planned at the detonation (counts follow the
  // intensity setting and the effects quality: fewer, bigger puffs on the
  // lower presets). Each has a birth time and a place on the stem, the cap
  // (a rolling torus filled with puffs, with a bright rim), the dust skirt, or
  // the condensation rings; _updateCloud moves them (analytically, so the
  // motion is smooth and cheap) and colours them by the fire's glow.
  _buildCloud(d) {
    const q = Math.max(0.3, Math.min(1.4, this.intensity * effectsQuality.scale * 1.15));
    const fat = 1 / Math.sqrt(q); // fewer puffs are bigger
    const R = d.R;
    const rnd = Math.random;
    d.cloudPuffs = [];
    d.q = q;
    const add = (o) => d.cloudPuffs.push({ p: null, a: rnd() * 6.283, ...o });
    // The stem: a column of swirling puffs, wide at the foot.
    const nStem = Math.round(190 * q);
    for (let i = 0; i < nStem; i++) {
      const u = Math.pow(rnd(), 0.8);
      add({ k: "stem", u, rr: Math.sqrt(rnd()), size: (0.16 + 0.22 * Math.pow(1 - u, 2)) * (0.75 + rnd() * 0.5) * fat, born: 0.7 + u * 3 + rnd() * 0.8, tone: 0.3 + rnd() * 0.35, swirl: 0.15 + rnd() * 0.25 });
    }
    // The cap: puffs filling a rolling torus; the outer ones (the rim) are bigger and brighter.
    const nCap = Math.round(430 * q);
    for (let i = 0; i < nCap; i++) {
      const rim = rnd() < 0.4;
      add({ k: "cap", th: rnd() * 6.283, ph: rnd() * 6.283, rho: rim ? 0.8 + rnd() * 0.25 : Math.sqrt(rnd()) * 0.85, rim, size: (rim ? 0.6 : 0.5) * (0.7 + rnd() * 0.6) * fat, born: 1.2 + rnd() * 3.5, tone: 0.35 + rnd() * 0.3, roll: 0.25 + rnd() * 0.2 });
    }
    // The dome on top of the cap, so it is not a hollow ring.
    const nDome = Math.round(70 * q);
    for (let i = 0; i < nDome; i++) add({ k: "dome", th: rnd() * 6.283, rho: Math.sqrt(rnd()), size: 0.55 * (0.8 + rnd() * 0.5) * fat, born: 1.8 + rnd() * 3, tone: 0.5 + rnd() * 0.3 });
    // The collar: a ring of white vapour under the cap.
    const nCollar = Math.round(46 * q);
    for (let i = 0; i < nCollar; i++) add({ k: "collar", th: (i / nCollar) * 6.283 + rnd() * 0.1, size: 0.34 * (0.8 + rnd() * 0.4) * fat, born: 3.2 + rnd() * 1.5 });
    // The condensation ring racing out of the blast (a Wilson cloud): a ring of white puffs.
    const nRing = Math.round(64 * q);
    for (let i = 0; i < nRing; i++) add({ k: "wilson", th: (i / nRing) * 6.283 + rnd() * 0.08, size: 0.4 * (0.8 + rnd() * 0.5) * fat, born: 0.25, off: rnd() });
    // Glowing fire inside the stem foot and the cap (additive).
    const nFire = Math.round(110 * q);
    for (let i = 0; i < nFire; i++) add({ k: i % 3 ? "fcap" : "fstem", th: rnd() * 6.283, rho: Math.sqrt(rnd()), u: rnd(), size: 0.42 * (0.7 + rnd() * 0.6) * fat, born: 0.4 + rnd() * 2.5, glow: 0.5 + rnd() * 0.5 });
  }

  // One frame of the cloud (T seconds after the blast).
  _updateCloud(d, dt) {
    const T = d.t;
    const R = d.R;
    const c = d.center;
    const q = d.q;
    // Dust racing out along the ground in the first seconds (ordinary puffs).
    d.cloudT += dt;
    const rate = 0.05 / q;
    while (d.cloudT > rate && T < 3.5) {
      d.cloudT -= rate;
      const a = Math.random() * Math.PI * 2;
      const sp = R * (0.9 + Math.random() * 0.8);
      this.cloud.spawn({ x: c.x + Math.cos(a) * R * 0.4, y: c.y + 1, z: c.z + Math.sin(a) * R * 0.4, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 3, vz: Math.sin(a) * sp, life: 9 + Math.random() * 8, size0: R * 0.3, size1: R * 0.95, color0: this._c.dust, color1: this._c.cloud, alpha: 0.5, drag: 0.7, hold: 0.4 });
    }
    // Where the parts are now.
    const H = d.height;
    const rise = 1 - Math.exp(-Math.max(0, T - 0.5) / 9);
    const capY = c.y + R * 0.6 + (H - R * 0.6) * rise;
    const Rm = R * (0.4 + 1.25 * (1 - Math.exp(-T / 7)));
    const rm = R * (0.2 + 0.5 * (1 - Math.exp(-T / 6)));
    const stemTop = capY - rm * 0.3;
    const dissolve = T > 70 ? Math.max(0, 1 - (T - 70) / 50) : 1; // everything thins out over the last minute
    const stemFade = T > 38 ? Math.max(0.15, 1 - (T - 38) / 60) : 1; // the stem thins out first
    const lit = Math.exp(-T / 10); // the fire's glow dies down
    const day = 0.4 + 0.6 * this.daylight;
    const col = this._tmpCol || (this._tmpCol = new THREE.Color());
    for (const e of d.cloudPuffs) {
      if (T < e.born) continue;
      let x, y, z, size, alpha, fireP = false;
      const grow = Math.min(1, (T - e.born) / 2.2); // a puff swells in
      let r = 0.5;
      let g = 0.47;
      let b = 0.44;
      switch (e.k) {
        case "stem": {
          const prof = R * (0.13 + 0.38 * Math.pow(1 - e.u, 3.2));
          const a = e.a + e.swirl * T * (1 - e.u * 0.6);
          x = c.x + Math.cos(a) * prof * e.rr * 1.3;
          z = c.z + Math.sin(a) * prof * e.rr * 1.3;
          y = c.y + 1 + e.u * (stemTop - c.y - 1);
          size = R * e.size * 1.3 * grow;
          alpha = 0.5 * stemFade * dissolve;
          const tone = e.tone * (0.6 + 0.4 * e.u);
          r = 0.04 + tone * 0.26;
          g = r * 0.93;
          b = r * 0.85;
          // The foot glows with the fire, and is lit orange from inside while it lasts.
          const glow = lit * (1 - e.u) * 0.9;
          r += glow * 0.9;
          g += glow * 0.38;
          b += glow * 0.1;
          break;
        }
        case "cap": {
          // Rolling: the cross-section angle advances (clockwise in the (out, up) plane).
          const ph = e.ph - e.roll * T;
          const hr = Rm + rm * e.rho * Math.cos(ph) * 1.15;
          const th = e.th + 0.02 * T;
          x = c.x + Math.cos(th) * hr;
          z = c.z + Math.sin(th) * hr;
          y = capY + rm * e.rho * Math.sin(ph) * 0.85;
          size = rm * e.size * 1.5 * grow;
          alpha = (e.rim ? 0.62 : 0.55) * dissolve;
          // Bright on top (sun-lit), darker beneath; the rim catches the light.
          const topLight = 0.5 + 0.5 * Math.sin(ph);
          const tone = (e.tone + (e.rim ? 0.15 : 0) + topLight * 0.28) * day;
          r = 0.035 + tone * 0.3;
          g = r * 0.93;
          b = r * 0.86;
          // Lit from inside by the fire: orange under the cap and in the middle, fading.
          const glow = lit * (e.rho < 0.6 ? 1.0 : 0.35) * (1.1 - topLight * 0.5);
          r += glow * 1.0;
          g += glow * 0.42;
          b += glow * 0.1;
          break;
        }
        case "dome": {
          const hr = e.rho * Rm * 0.95;
          const th = e.th;
          x = c.x + Math.cos(th) * hr;
          z = c.z + Math.sin(th) * hr;
          y = capY + rm * (0.75 - 0.55 * e.rho * e.rho);
          size = rm * e.size * 1.6 * grow;
          alpha = 0.55 * dissolve;
          const tone = (e.tone + 0.15) * day;
          r = 0.04 + tone * 0.32;
          g = r * 0.93;
          b = r * 0.86;
          const glow = lit * 0.35;
          r += glow;
          g += glow * 0.4;
          b += glow * 0.1;
          break;
        }
        case "collar": {
          const hr = Rm * 0.98 + rm * 0.2;
          x = c.x + Math.cos(e.th) * hr;
          z = c.z + Math.sin(e.th) * hr;
          y = capY - rm * 0.9;
          size = rm * e.size * 1.2 * grow;
          alpha = 0.26 * Math.min(1, (T - 3) / 4) * (T > 45 ? Math.max(0, 1 - (T - 45) / 25) : 1);
          r = 0.55 * day + 0.05;
          g = 0.55 * day + 0.05;
          b = 0.57 * day + 0.06;
          break;
        }
        case "wilson": {
          // The condensation ring: a flash of white vapour racing out of the
          // blast on the shock front, and gone in a few seconds.
          const t = T - e.born;
          if (t > 5.5) {
            alpha = 0;
            x = c.x;
            y = c.y;
            z = c.z;
            size = 0;
            break;
          }
          const rr = R * (1.1 + 3.4 * Math.pow(Math.max(0, t), 0.75)) * (0.96 + e.off * 0.08);
          x = c.x + Math.cos(e.th) * rr;
          z = c.z + Math.sin(e.th) * rr;
          y = c.y + R * (0.5 + 0.55 * t + e.off * 0.25);
          size = R * e.size * (0.9 + t * 0.35) * Math.min(1, t * 4);
          alpha = 0.55 * Math.pow(Math.max(0, 1 - t / 5.5), 1.4);
          r = 0.7 * day + 0.1;
          g = 0.68 * day + 0.1;
          b = 0.66 * day + 0.1;
          break;
        }
        default: {
          // Glowing fire in the stem foot and the cap (additive, early on).
          const a = e.th + 0.3 * T;
          if (e.k === "fstem") {
            const prof = R * 0.22 * e.rho;
            x = c.x + Math.cos(a) * prof;
            z = c.z + Math.sin(a) * prof;
            y = c.y + 2 + e.u * (stemTop - c.y) * 0.5;
          } else {
            const hr = Rm * 0.8 * e.rho;
            x = c.x + Math.cos(a) * hr;
            z = c.z + Math.sin(a) * hr;
            y = capY - rm * 0.25 + (e.u - 0.5) * rm;
          }
          size = R * e.size * 1.2 * grow;
          alpha = 0.5 * lit * lit * e.glow * dissolve;
          r = 3;
          g = 1.3;
          b = 0.35;
          fireP = true;
        }
      }
      if (!e.p) {
        const pool = fireP ? this.fire : this.cloud;
        // (Planned and driven by us: a long life, never moved by the pool.)
        e.p = pool.spawn({ x, y, z, life: 140, size0: 1, size1: 1, color0: new THREE.Color(), alpha: 1, hold: 0.985, spin: (Math.random() - 0.5) * 0.12 });
        e.pool = pool;
      }
      const p = e.p;
      p.x = x;
      p.y = y;
      p.z = z;
      p.size0 = p.size1 = Math.max(0.01, size);
      p.alpha = alpha;
      p.c0.setRGB(r, g, b);
      p.c1 = p.c0;
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

  update(dt, listener, daylight = 1) {
    if (listener) this.listener.copy(listener);
    this.daylight = daylight;
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
      this._updateCloud(d, dt);
      if (d.t > 125 && d.slice >= d.slices && d.scorched) this.active.splice(i, 1);
    }
    if (!anyBall) this.ball.visible = false;
  }

  // The radius of the blast's damage (for tests / HUD).
  static damageRadius(R) {
    return R * 2;
  }
}


