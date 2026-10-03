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
import { BLOCK, IS_LEAVES, IS_LOG, IS_SOLID } from "./blocks.js";
import { LAYER_FX } from "./layers.js";
import { WORLD_HEIGHT } from "./constants.js";

export const NUKE_MIN_SIZE = 12;
export const NUKE_MAX_SIZE = 200; // (Round 6: the default is the old maximum, 96)
export const NUKE_DEFAULTS = { size: 96, intensity: "high" };
// Depth of the crater: about what a size-44 nuke used to dig (22 blocks), growing
// only slowly with the size, so a big nuke makes a very wide, shallow-looking bowl.
const craterDepth = (R) => 22 * Math.sqrt(R / 44);
// (Round 8) The crater's width: as wide as the mushroom's cap gets (about
// 1.6x the size), at the same depth; beyond it everything standing is
// swept away out to CLEAR, trees are knocked flat out to KNOCK, and burnt
// (leaves and plants gone, trunks left as stumps) out to BURN.
const CRATER_W = 1.6;
const CLEAR = 1.85;
export const NUKE_CLEAR = CLEAR; // (distant.js: no far-off building shapes where a nuke swept everything away)
const KNOCK = 2.6;
const BURN = 3.3;
const isPlant = (id) => IS_LEAVES[id] || id === BLOCK.TALL_GRASS || id === BLOCK.FLOWER_RED || id === BLOCK.FLOWER_YELLOW || id === BLOCK.SNOW;
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
    // (Round 8) Blast zones: every nuke's zone is remembered (saved with the
    // world) and applied to each chunk that generates later inside it, so
    // terrain that wasn't loaded at the time (or a tree cut in half at a
    // chunk's edge) is cleared too when you get there: nothing is left
    // standing or floating. Each zone remembers which chunks it has done.
    this.zones = []; // { x, y, z, R, done: Set of chunk keys }
    world.onChunkGenerated = (chunk) => this._chunkGenerated(chunk);
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

  // opts.mirror (multiplayer): another player's nuke seen here: the flash,
  // fireball, shockwave and cloud, and what it does to this player, but not
  // the crater (its blocks arrive as edits). opts.R: its size.
  detonate(center, { mirror = false, R: size = null } = {}) {
    const R = size ?? this.radius;
    const d = {
      center: center.clone(),
      R,
      t: 0,
      slice: 0,
      shape: makeCraterShape(Math.max(0.75, R * 0.1)),
      removed: [],
      scorched: false,
      cloudT: 0,
      slices: Math.max(SLICES_MIN, Math.ceil((R * CRATER_W) / 4)), // the crater is carved in this many slices over frames
      clearR: R * CLEAR, // everything standing within this is destroyed (see _scorch)
      knockR: R * KNOCK,
      burnR: R * BURN,
      height: Math.min(300, 50 + R * 3.8), // mushroom cap height above the ground
      mirror,
    };
    if (mirror) {
      // (Another player's nuke: its crater arrives as their edits; the blast
      // zone is applied here too, locally, so ground they never loaded but we
      // have is cleared just the same: the rules are the same everywhere.)
      d.slice = d.slices;
    }
    // The zone, for terrain that streams in later; the chunks loaded now are
    // done by the scorch pass.
    const zone = { x: center.x, y: center.y, z: center.z, R, done: new Set() };
    const r = R * BURN;
    for (let cz = Math.floor((center.z - r) / 16); cz <= Math.floor((center.z + r) / 16); cz++) {
      for (let cx = Math.floor((center.x - r) / 16); cx <= Math.floor((center.x + r) / 16); cx++) if (this.world.getChunk(cx, cz)) zone.done.add(`${cx},${cz}`);
    }
    this.zones.push(zone);
    if (this.zones.length > 24) this.zones.shift();
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
    if (this.onDetonate) this.onDetonate(center, R, { mirror });
    return d;
  }

  _carveSlice(d) {
    const c = d.center;
    const R = d.R;
    const Rc = R * CRATER_W; // (Round 8: much wider, the same depth)
    const x0 = Math.floor(c.x - Rc) - 2;
    const width = Math.ceil((2 * Rc + 5) / d.slices);
    const a = x0 + d.slice * width;
    const removed = this.effects._carve(c, Rc, { shape: d.shape, x0: a, x1: a + width - 1, maxRadius: Rc + 20, vScale: Rc / craterDepth(R) });
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

  // The blast zone, a bounded number of columns per frame.
  // - Within `clearR` (a bit wider than the crater) EVERYTHING above the
  //   natural ground goes: trunks, leaves, grass, flowers, snow, houses, city
  //   blocks, hangars, towers, fences, lamps... and a runway, apron, taxiway
  //   or street surface is turned back into plain scorched earth. (The
  //   crater itself takes the ground; this takes whatever stood on it, so
  //   nothing is left floating or standing on the crater's rim.)
  // - Out to 2R the land is scorched: grass turns to dirt, and the topmost
  //   leaves, plants and snow of each column burn off (trunks stay as
  //   charred stumps).
  // Columns in chunks that are not loaded yet are retried later (when the
  // player flies closer), for as long as the explosion's effects last.
  _scorch(d, budget) {
    const w = this.world;
    const c = d.center;
    const R2 = d.burnR;
    if (!d.scorchCols) {
      d.deferred = [];
      // The columns, nearest first (a counting sort by ring), so the clearing
      // spreads outward like the shockwave.
      const RING = 6;
      const rings = Math.ceil(R2 / RING) + 1;
      const counts = new Uint32Array(rings + 1);
      const x0 = Math.floor(c.x - R2);
      const x1 = Math.ceil(c.x + R2);
      const z0 = Math.floor(c.z - R2);
      const z1 = Math.ceil(c.z + R2);
      let total = 0;
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const q = (x + 0.5 - c.x) ** 2 + (z + 0.5 - c.z) ** 2;
          if (q > R2 * R2) continue;
          counts[Math.floor(Math.sqrt(q) / RING) + 1]++;
          total++;
        }
      }
      for (let i = 1; i <= rings; i++) counts[i] += counts[i - 1];
      d.scorchCols = new Int32Array(total * 2);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const q = (x + 0.5 - c.x) ** 2 + (z + 0.5 - c.z) ** 2;
          if (q > R2 * R2) continue;
          const k = counts[Math.floor(Math.sqrt(q) / RING)]++;
          d.scorchCols[k * 2] = x;
          d.scorchCols[k * 2 + 1] = z;
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
      if (!this._scorchColumn(d, x, z, edits)) d.deferred.push(x, z);
    }
    if (edits.length) w.setBlocks(edits, { remote: d.mirror });
    return d.scorchI >= d.scorchCols.length;
  }

  // Retries the columns whose chunks were not loaded (a few hundred per call).
  _retryDeferred(d, budget) {
    if (!d.deferred || d.deferred.length === 0) return;
    const edits = [];
    const keep = [];
    let n = 0;
    for (let i = 0; i < d.deferred.length; i += 2) {
      const x = d.deferred[i];
      const z = d.deferred[i + 1];
      if (n >= budget) {
        keep.push(x, z);
        continue;
      }
      if (!this.world.getChunk(x >> 4, z >> 4)) {
        keep.push(x, z);
        continue;
      }
      n++;
      this._scorchColumn(d, x, z, edits);
    }
    d.deferred = keep;
    if (edits.length) this.world.setBlocks(edits, { remote: d.mirror });
  }

  // Returns false when the column's chunk is not loaded (nothing done).
  _scorchColumn(d, x, z, edits) {
    const w = this.world;
    const chunk = w.getChunk(x >> 4, z >> 4);
    if (!chunk) return false;
    const blocks = chunk.blocks;
    const col = ((z & 15) << 4) | (x & 15);
    const c = d.center;
    const dist2 = (x + 0.5 - c.x) ** 2 + (z + 0.5 - c.z) ** 2;
    if (dist2 <= d.clearR * d.clearR) {
      // Everything above the natural ground.
      const h = w.heightAt(x, z);
      const top = Math.min(WORLD_HEIGHT - 1, h + 120);
      for (let y = top; y > h; y--) {
        const id = blocks[(y << 8) | col];
        if (id !== BLOCK.AIR && id !== BLOCK.WATER) edits.push(x, y, z, BLOCK.AIR);
      }
      // The surface: grass burns to dirt, a runway / apron / street goes back to earth.
      const id = blocks[(h << 8) | col];
      if (id !== BLOCK.AIR && id !== BLOCK.WATER && h > 1) {
        const man = this.world.terrain.sites?.surfaceAt?.(x, z);
        if (id === BLOCK.GRASS || id === BLOCK.SNOW || man) edits.push(x, h, z, BLOCK.DIRT);
      }
      return true;
    }
    const dist = Math.sqrt(dist2);
    const h = w.heightAt(x, z);
    // Leaves, grass, flowers and snow burn off all the way down the column
    // (a tree's crown is several leaves deep: all of it goes).
    let trunkBase = -1;
    for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
      const id = blocks[(y << 8) | col];
      if (id === BLOCK.AIR) continue;
      if (isPlant(id)) {
        edits.push(x, y, z, BLOCK.AIR);
        continue;
      }
      if (IS_LOG[id]) {
        // A standing trunk: logs down to the ground.
        let yb = y;
        while (yb > 1 && IS_LOG[blocks[((yb - 1) << 8) | col]]) yb--;
        if (y - yb >= 1 && yb <= h + 2) trunkBase = yb;
        y = yb; // (go on below the trunk: the ground)
        continue;
      }
      if (id === BLOCK.GRASS) edits.push(x, y, z, BLOCK.DIRT);
      break;
    }
    if (trunkBase < 0) return true;
    // The trunk: knocked flat (closer in) or burnt down to a stump (farther out).
    let top = trunkBase;
    while (top + 1 < WORLD_HEIGHT && IS_LOG[blocks[((top + 1) << 8) | col]]) top++;
    const logId = blocks[(trunkBase << 8) | col];
    if (dist <= d.knockR) {
      for (let y = trunkBase; y <= top; y++) edits.push(x, y, z, BLOCK.AIR);
      // It lies on the ground pointing away from the blast (a few logs long).
      const dx = (x + 0.5 - c.x) / (dist || 1);
      const dz = (z + 0.5 - c.z) / (dist || 1);
      const len = Math.min(5, top - trunkBase + 1);
      for (let k = 1; k <= len; k++) {
        const fx = Math.floor(x + 0.5 + dx * k);
        const fz = Math.floor(z + 0.5 + dz * k);
        if (!w.getChunk(fx >> 4, fz >> 4)) break;
        let gy = trunkBase;
        while (gy > 1 && !IS_SOLID[w.getBlock(fx, gy - 1, fz)]) gy--;
        while (gy < WORLD_HEIGHT - 1 && IS_SOLID[w.getBlock(fx, gy, fz)]) gy++;
        if (Math.abs(gy - trunkBase) > 3) break;
        edits.push(fx, gy, fz, logId);
      }
    } else {
      for (let y = trunkBase + 2; y <= top; y++) edits.push(x, y, z, BLOCK.AIR);
    }
    return true;
  }

  // A chunk that generated after a nuke went off inside its zone: the blast
  // zone's rules applied to it now (once per zone and chunk), locally.
  _chunkGenerated(chunk) {
    if (!this.zones.length) return;
    const key = `${chunk.cx},${chunk.cz}`;
    const x0 = chunk.cx * 16;
    const z0 = chunk.cz * 16;
    for (const zone of this.zones) {
      if (zone.done.has(key)) continue;
      const r = zone.R * BURN;
      const nx = Math.max(x0, Math.min(x0 + 16, zone.x));
      const nz = Math.max(z0, Math.min(z0 + 16, zone.z));
      if ((nx - zone.x) ** 2 + (nz - zone.z) ** 2 > r * r) continue;
      zone.done.add(key);
      const d = { center: new THREE.Vector3(zone.x, zone.y, zone.z), R: zone.R, clearR: zone.R * CLEAR, knockR: zone.R * KNOCK, burnR: r };
      const edits = [];
      for (let z = z0; z < z0 + 16; z++) {
        for (let x = x0; x < x0 + 16; x++) {
          if ((x + 0.5 - zone.x) ** 2 + (z + 0.5 - zone.z) ** 2 > r * r) continue;
          this._scorchColumn(d, x, z, edits);
        }
      }
      // (Local: every player's game does this for itself, the same way.)
      if (edits.length) this.world.setBlocks(edits, { remote: true });
    }
  }

  // The zones, for the world save.
  serializeZones() {
    return this.zones.map((z) => ({ x: Math.round(z.x * 10) / 10, y: Math.round(z.y * 10) / 10, z: Math.round(z.z * 10) / 10, R: z.R, done: [...z.done] }));
  }

  loadZones(list) {
    this.zones = [];
    for (const z of Array.isArray(list) ? list : []) {
      if (![z.x, z.y, z.z, z.R].every(Number.isFinite) || !Array.isArray(z.done)) continue;
      this.zones.push({ x: z.x, y: z.y, z: z.z, R: z.R, done: new Set(z.done.filter((k) => typeof k === "string")) });
    }
    // (Chunks already loaded that a zone hasn't done yet: now.)
    if (this.zones.length) for (const chunk of this.world.chunks.values()) this._chunkGenerated(chunk);
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
      if (!d.scorched) d.scorched = this._scorch(d, 2500);
      else if (d.slice >= d.slices && d.t - (d.retryT ?? 0) > 2) {
        d.retryT = d.t;
        this._retryDeferred(d, 1500);
      }
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
      if (d.t > 125 && d.slice >= d.slices && d.scorched) {
        this._retryDeferred(d, 4000);
        this.active.splice(i, 1);
      }
    }
    if (!anyBall) this.ball.visible = false;
  }

  // The radius of the blast's damage (for tests / HUD).
  static damageRadius(R) {
    return R * 2;
  }

  // How far the crater reaches (horizontally) for a nuke of size R.
  static craterRadius(R) {
    return R * CRATER_W;
  }
}


