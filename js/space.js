// Space (Round 15; Round 16: no cutscenes, the real solar system). The
// rocket (js/rocket.js) climbs from its pad, or any UFO flies up; past the
// space line (js/solar-data.js: 6,000 blocks over the Overworld, well above
// where planes fly; 3,000 over the Moon, 4,500 over Mars) the craft flies on
// into the solar system (js/solar.js: the same camera, craft and velocity,
// no menu), on to the Moon, Mars or anywhere, and down into a planet again
// (its dimension: js/dimensions.js travel), where the rocket lands on its
// legs (its autopilot, or the player) and a UFO flies on.
//
// Round 15's orbit scene (the menu, the transfer cinematic, the canned
// descent) is gone; what is left here is the trip's frame:
//   - the captions (the countdown, the stages, the cues);
//   - the climb's sky: darker by the eye's height (js/space-sky.js), and the
//     planet below drawn under the view high up;
//   - the hand-over: watching the player's craft cross the space line
//     (readying space's scene a little before), and main.js's hooks: `view`
//     and render (space drawn instead of the world), `busy` (in space: the
//     online player data), `worldIdle` (the voxel world rests: nothing
//     streamed or meshed while it isn't drawn);
//   - the planets' rules that need the game (low gravity is the physics' own:
//     player.js, mobs.js and entities.js read the dimension's `gravity`):
//     sounds muffled where there is no air, Mars' dust devils, the boosters
//     falling away (anyone's rocket, a puppet's too).
//
// Saving: `sites` (the pad on Earth, the landing places) and `solar` (the
// solar clock, the planets' turn, the guides, a UFO's place in space) in the
// player's save. A rocket saved in flight is back on its pad, or on the
// ground below it (js/rocket.js serialize); a UFO saved in space is put back
// up at the space line it left by and flies on from where it was.
// Online: each player flies their own craft and travels on their own (the
// dimensions engine); the others watch a launch (the rocket is a shared
// vehicle) until it is out of sight.
import * as THREE from "three";
import { ROCKET_HOOKS, createBoosterMesh } from "./rocket.js";
import { SpaceSky, planetTexture } from "./space-sky.js";
import { SolarSystem } from "./solar.js";
import { skyDark, spaceLineY, BODY_OF_DIM } from "./solar-data.js";
import { effectsQuality } from "./effects.js";
import { WORLD_HEIGHT } from "./constants.js";

const NAME_OF = { overworld: "Earth", moon: "the Moon", mars: "Mars" };
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const rand = (a, b) => a + Math.random() * (b - a);

export class SpaceSystem {
  // game: main.js's game object; extra: { dims, mp, renderer }
  constructor(game, extra = {}) {
    this.game = game;
    this.dims = extra.dims || game.dims;
    this.mp = extra.mp || null;
    this.renderer = extra.renderer || null;
    this.world = game.world;
    this.player = game.player;
    this.vehicles = game.vehicles;
    this.sky = new SpaceSky(game);
    this.sites = {}; // dim -> [x, y, z]: Earth's pad, the last landing on the Moon and Mars
    this.debris = []; // falling boosters
    this.devils = []; // Mars' dust devils
    this._devilT = 20;
    this._muffled = null;
    this.stats = { launches: 0, landings: 0 };
    ROCKET_HOOKS.space = this;
    this._makeDom();
    this.solar = new SolarSystem(this);
  }

  // In space (the player's craft is the solar system's).
  get busy() {
    return this.solar.active;
  }

  // (main.js renderFrame: space is drawn instead of the world)
  get view() {
    return this.solar.active ? this.solar.view : null;
  }

  // (main.js: the voxel world rests while space is drawn, unless a landing's ground is loading)
  get worldIdle() {
    return this.solar.active && !this.dims?.pending;
  }

  // ---------- Captions ----------

  _makeDom() {
    if (typeof document === "undefined") return;
    const st = document.createElement("style");
    st.textContent = `
#space-hud { position: fixed; inset: 0; pointer-events: none; z-index: 30; font-family: "Segoe UI", system-ui, sans-serif; color: #fff; }
#space-hud .cap { position: absolute; left: 50%; transform: translateX(-50%); text-align: center; text-shadow: 0 2px 8px rgba(0,0,0,0.8); opacity: 0; transition: opacity 0.35s; white-space: nowrap; }
#space-hud .cap.count { top: 22%; font: 800 120px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 2px; color: #ffe9b0; }
#space-hud .cap.big { top: 26%; font: 800 52px/1.1 "Segoe UI", system-ui, sans-serif; letter-spacing: 6px; }
#space-hud .cap.stage { top: 18%; font: 600 26px/1.2 "Segoe UI", system-ui, sans-serif; letter-spacing: 3px; color: #cfe7ff; }
#space-hud .cap.hint { top: 36%; font: 500 18px/1.3 "Segoe UI", system-ui, sans-serif; color: #e8eef6; background: rgba(8,12,20,0.55); padding: 6px 14px; border-radius: 6px; }
body.hud-off #space-hud { display: none; }
`;
    document.head.appendChild(st);
    const el = document.createElement("div");
    el.id = "space-hud";
    el.innerHTML = `<div class="cap count"></div><div class="cap big"></div><div class="cap stage"></div><div class="cap hint"></div>`;
    document.body.appendChild(el);
    this.el = el;
    this.caps = {};
    for (const k of ["count", "big", "stage", "hint"]) this.caps[k] = { el: el.querySelector(`.cap.${k}`), t: 0 };
  }

  // A line on screen for `seconds`: kind "count" | "big" | "stage" | "hint".
  caption(text, kind = "hint", seconds = 2.5) {
    const c = this.caps?.[kind];
    if (!c) return;
    c.el.textContent = text;
    c.el.style.opacity = "1";
    c.t = seconds;
    this.lastCaption = text;
  }

  _captions(dt) {
    if (!this.caps) return;
    for (const c of Object.values(this.caps)) {
      if (c.t <= 0) continue;
      c.t -= dt;
      if (c.t <= 0) c.el.style.opacity = "0";
    }
  }

  // ---------- The rocket's word ----------

  onCountdown(r) {
    // (the planets' looks, painted a little each frame from now: ready by space)
    if (r === this.vehicles.active) for (const n of ["earth", "earthClouds", "earthNight", "moon", "mars"]) planetTexture(n);
    if (r === this.vehicles.active) this.caption(r.stack === "ship" ? "Lift-off in 3" : "Countdown: T-10", "stage", 2);
  }

  onLiftoff(r) {
    // (Earth's pad: remembered, a place to come home to)
    if (!r.puppet && r.pad && this.world.dim === "overworld") this.sites.overworld = r.pad.slice();
    if (!r.puppet) this.stats.launches++;
  }

  // A rocket flew on into space with nobody aboard: it is gone.
  goneToSpace(r) {
    if (r.puppet) return;
    if (r !== this.vehicles.active) this.vehicles.remove(r);
  }

  // The boosters fall away: four of them tumbling down, trailing smoke, gone
  // where they meet the ground (a puff of dust) or after 20 s.
  dropBoosters(r) {
    r.root.updateMatrixWorld(true);
    for (const b of r.model.boosters) {
      const mesh = createBoosterMesh();
      b.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      this.game.scene.add(mesh);
      _v.copy(mesh.position).sub(r.pos);
      _v.y = 0;
      _v.normalize();
      this.debris.push({ mesh, vel: r.vel.clone().addScaledVector(_v, 5), spin: new THREE.Vector3(_v.z, 0, -_v.x).multiplyScalar(rand(0.5, 1.1)), t: 0, fx: 0 });
    }
  }

  // The ship stood up on its legs.
  landed(r) {
    if (r.puppet) return;
    const dim = this.world.dim || "overworld";
    this.sites[dim] = [Math.round(r.pos.x), Math.round(r.pos.y), Math.round(r.pos.z)];
    this.stats.landings++;
    this.caption(dim === "overworld" ? "Welcome home" : `Welcome to ${NAME_OF[dim] || "space"}`, "big", 3.5);
    this.caption("F: get out · Space: lift off again (to space)", "hint", 6);
  }

  // ---------- Every frame ----------

  update(dt) {
    this._captions(dt);
    const dim = this.world.dim || "overworld";
    const g = this.game;
    const running = !(g.gameState === "paused" && !this.mp?.active) && g.gameState !== "start";
    // The hand-over: the player's craft past the space line flies on into space.
    const s = this.solar;
    const v = this.vehicles.active;
    if (!s.active && v && running && s.canLeave(v)) {
      const line = spaceLineY(dim);
      if (v.pos.y > line * 0.55) s.prewarm(v, this.renderer);
      if (v.pos.y > line) s.enter(v);
    }
    s.update(dt, running);
    // the climb's sky: by the eye's height (Round 16: well above the planes)
    const cam = g.camera;
    let k = 0;
    if (BODY_OF_DIM[dim] && cam && !s.active) k = skyDark(cam.position.y, dim);
    this.sky.altK += (k - this.sky.altK) * Math.min(1, dt * 3);
    this._debris(dt);
    this._muffle(dim);
    if (dim === "mars" && !s.active) this._dustDevils(dt);
    else if (this.devils.length) this.devils.length = 0;
  }

  // Draws space's scene (main.js renderFrame, while `view` is set).
  render(renderer, postfx = null) {
    if (!this.solar.active) return false;
    return this.solar.render(renderer, postfx);
  }

  // Back from space at once (death, a mode change...): the world as it is.
  abort() {
    this.solar.abort();
  }

  _debris(dt) {
    const L = this.debris;
    if (!L.length) return;
    const fx = this.game.effects;
    const g = 26 * (this.world.dimInfo?.gravity ?? 1);
    for (let i = L.length - 1; i >= 0; i--) {
      const d = L[i];
      d.t += dt;
      d.vel.y -= g * 0.6 * dt;
      d.vel.multiplyScalar(Math.exp(-dt * 0.05));
      d.mesh.position.addScaledVector(d.vel, dt);
      _q.setFromAxisAngle(_v.copy(d.spin).normalize(), d.spin.length() * dt);
      d.mesh.quaternion.premultiply(_q);
      d.fx -= dt;
      if (fx?.trail && d.fx <= 0 && d.t < 5) {
        d.fx = 0.12 / Math.max(0.3, effectsQuality.scale);
        fx.trail.spawn({ x: d.mesh.position.x, y: d.mesh.position.y, z: d.mesh.position.z, vx: rand(-0.5, 0.5), vy: rand(-0.3, 0.3), vz: rand(-0.5, 0.5), life: 8, size0: 2, size1: 7, color0: DEBRIS_SMOKE, color1: DEBRIS_SMOKE2, alpha: 0.6, drag: 0.3, hold: 0.5 });
      }
      const ground = this.world.getChunk(Math.floor(d.mesh.position.x) >> 4, Math.floor(d.mesh.position.z) >> 4) ? this.vehicles.groundBelow(d.mesh.position.x, Math.min(WORLD_HEIGHT, d.mesh.position.y), d.mesh.position.z) : -1e9;
      if (d.mesh.position.y < ground + 1 || d.t > 22 || d.mesh.position.y < -20) {
        if (d.mesh.position.y < ground + 1 && fx?.smoke) for (let k = 0; k < 10; k++) fx.smoke.spawn({ x: d.mesh.position.x, y: ground + 0.5, z: d.mesh.position.z, vx: rand(-5, 5), vy: rand(1, 4), vz: rand(-5, 5), life: 3, size0: 2, size1: 6, color0: DEBRIS_SMOKE, alpha: 0.7, drag: 1.2 });
        this.game.scene.remove(d.mesh);
        L.splice(i, 1);
      } else {
        const l = this.world.lightAt ? this.world.lightAt(d.mesh.position.x, d.mesh.position.y, d.mesh.position.z) : null;
        d.mesh.userData.light.sky = l ? l.sky : 15;
      }
    }
  }

  // No air: everything the world makes sounds muffled (the blocks, the
  // creatures, the player, the weapons' buses through a low-pass); the
  // voice and the menus' sounds as ever. (Round 16: in space too.)
  _muffle(dim) {
    const a = this.game.audio;
    if (!a?.ctx || !a.buses) return;
    const want = !!this.world.dimInfo?.airless || this.solar.active;
    if (want === this._muffled) return;
    this._muffled = want;
    if (!this._lp) {
      this._lp = a.ctx.createBiquadFilter();
      this._lp.type = "lowpass";
      this._lp.frequency.value = 520;
      this._lp.Q.value = 0.4;
      this._lp.connect(a.master);
    }
    for (const name of ["blocks", "creatures", "player", "weapons"]) {
      const bus = a.buses[name];
      if (!bus) continue;
      try {
        bus.disconnect();
      } catch {
        // (not connected)
      }
      bus.connect(want ? this._lp : a.master);
    }
  }

  // Mars' dust devils: now and then (by day) a whirl of dust wandering over
  // the ground in sight, rising in a twisting column, for 15 s or so.
  _dustDevils(dt) {
    const fx = this.game.effects;
    if (!fx?.trail) return;
    this._devilT -= dt;
    const p = this.player.position;
    if (this._devilT <= 0 && this.devils.length < 2) {
      this._devilT = rand(25, 55);
      const a = Math.random() * Math.PI * 2;
      const d = rand(40, 90);
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (this.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) this.devils.push({ x, z, vx: rand(-3, 3), vz: rand(-3, 3), t: 0, life: rand(12, 20), fx: 0, a: 0, h: rand(18, 32) });
    }
    for (let i = this.devils.length - 1; i >= 0; i--) {
      const d = this.devils[i];
      d.t += dt;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.a += dt * 6;
      if (d.t > d.life) {
        this.devils.splice(i, 1);
        continue;
      }
      d.fx -= dt;
      if (d.fx > 0) continue;
      d.fx = 0.07 / Math.max(0.3, effectsQuality.scale);
      const k = Math.sin((d.t / d.life) * Math.PI);
      const gy = this.vehicles.groundBelow(d.x, WORLD_HEIGHT - 1, d.z);
      for (let j = 0; j < 2; j++) {
        const h = Math.random() * d.h;
        const r = 0.8 + h * 0.18;
        const a = d.a + h * 0.5 + j * Math.PI;
        fx.trail.spawn({ x: d.x + Math.cos(a) * r, y: gy + h, z: d.z + Math.sin(a) * r, vx: -Math.sin(a) * 4 + d.vx, vy: 2 + Math.random() * 2, vz: Math.cos(a) * 4 + d.vz, life: 2.5, size0: 1.5 + h * 0.05, size1: 3 + h * 0.12, color0: DEVIL, color1: DEVIL2, alpha: 0.45 * k, drag: 0.8, hold: 0.3 });
      }
    }
  }

  // ---------- Saving ----------

  // For the player's save (main.js playerState: spread after the
  // dimensions'): the sites and the solar system's state.
  serialize() {
    const sites = Object.keys(this.sites).length ? this.sites : undefined;
    return { space: { sites, solar: this.solar.serialize() } };
  }

  // From the player's save (after the dimensions' and the vehicles': the
  // world is already in the dimension it was saved in, the player seated).
  init(saved) {
    if (!saved || typeof saved !== "object") return;
    if (saved.sites && typeof saved.sites === "object") {
      for (const [dim, p] of Object.entries(saved.sites)) if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) && NAME_OF[dim]) this.sites[dim] = p.slice();
    }
    this.solar.init(saved.solar);
    // (Round 15's saves made mid-trip: the trip's rocket is back on its pad as it was)
    const t = saved.trip;
    if (t && Array.isArray(t.pad) && t.pad.length === 3 && t.pad.every(Number.isFinite)) {
      const full = t.stack === "full";
      const v = this.vehicles.create("rocket", { stack: full ? "full" : "ship", phase: full ? "pad" : "landed", pos: t.pad.slice(), pad: full ? t.pad.slice() : undefined, tower: full, yaw: Number.isFinite(t.yaw) ? t.yaw : 0, summoned: true });
      if (v) this.caption("The trip was cut short: back at the pad", "hint", 4);
    }
  }
}

const DEBRIS_SMOKE = new THREE.Color(0.8, 0.79, 0.78);
const DEBRIS_SMOKE2 = new THREE.Color(0.6, 0.6, 0.6);
const DEVIL = new THREE.Color(0.68, 0.4, 0.25);
const DEVIL2 = new THREE.Color(0.55, 0.32, 0.2);
