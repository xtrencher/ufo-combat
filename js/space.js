// Space (Round 15): the trip from a launch pad to orbit and on to the Moon,
// Mars or back to Earth. The rocket (js/rocket.js) climbs in the world; at
// engine cut-off this takes over:
//   insert    the orbit's own scene (drawn instead of the world: main.js
//             renderFrame asks `view`): the stack over the curve of the
//             planet below, the core stage separating and tumbling away, the
//             ship's engine finishing the burn
//   orbit     the ship drifting over the planet, the sun, the stars; the
//             choice of where to go (1 the Moon, 2 Mars, 3 Earth; the planet
//             below: land again); the mouse turns the view
//   transfer  the burn and the coast: the planet left behind shrinking, the
//             one ahead growing until it fills the view; meanwhile the world
//             goes to that dimension (js/dimensions.js travel: its ground
//             loads behind the scenes, its loading screen kept hidden)
//   approach  over the new planet, flipping engine-first, the entry's glow
//             (an atmosphere), the descent burn lighting; a fade to black
//   (then)    the world again: the ship in the sky over the landing zone,
//             coming down (js/rocket.js descent: the autopilot or the
//             player), its legs, the dust, the touchdown
// Where it lands: on the Moon and Mars the landing zone (0, 0: the planets'
// generators keep it clear, a probe and a monolith or ruin in sight) or the
// last place this player landed there; back on Earth the pad it left from
// (else the world spawn).
//
// Also here: the planets' rules that need the game (low gravity is the
// physics' own: player.js, mobs.js and entities.js read the dimension's
// `gravity`): sounds muffled where there is no air, Mars' dust devils, the
// boosters falling away (anyone's rocket, a puppet's too), the captions.
//
// Saving: `sites` (the pad on Earth, the landing places) in the player's
// save; a save in the middle of a trip puts the player back at the pad it
// left from with the rocket on it (as if it never went).
// Online: each player flies their own rocket and travels on their own (the
// dimensions engine); the others watch the launch (the rocket is a shared
// vehicle) and see a ship come down where they are.
import * as THREE from "three";
import { ROCKET_HOOKS, createRocketModel, createBoosterMesh } from "./rocket.js";
import { SpaceSky, createPlanet, planetTexture, pumpPlanetTextures } from "./space-sky.js";
import { effectsQuality } from "./effects.js";
import { WORLD_HEIGHT } from "./constants.js";
import { voice } from "./voice.js";

const R = 600; // a planet's radius in the orbit's scene
const ORBIT_ALT = 70;
const INSERT_T = 5.5;
const TRANSFER_T = 9;
const APPROACH_T = 5;
const FADE_T = 0.6;
const DEST = [
  { key: "Digit1", dim: "moon", name: "the Moon", label: "Moon", planet: "moon" },
  { key: "Digit2", dim: "mars", name: "Mars", label: "Mars", planet: "mars" },
  { key: "Digit3", dim: "overworld", name: "Earth", label: "Earth", planet: "earth" },
];
const PLANET_OF = { overworld: "earth", moon: "moon", mars: "mars" };
const NAME_OF = { overworld: "Earth", moon: "the Moon", mars: "Mars" };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v3 = new THREE.Vector3();
const _q2a = new THREE.Vector3();
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rand = (a, b) => a + Math.random() * (b - a);

export class SpaceSystem {
  // game: main.js's game object; extra: { dims, mp, renderer }
  constructor(game, extra = {}) {
    this.game = game;
    this.dims = extra.dims || game.dims;
    this.mp = extra.mp || null;
    this.world = game.world;
    this.player = game.player;
    this.vehicles = game.vehicles;
    this.sky = new SpaceSky(game);
    this.sites = {}; // dim -> [x, y, z]: Earth's pad, the last landing on the Moon and Mars
    this.trip = null; // { phase, t, from, to, stack, pad, yaw, ... }
    this.view = null; // { scene, camera } while the orbit's scene is drawn
    this.debris = []; // falling boosters
    this.devils = []; // Mars' dust devils
    this._devilT = 20;
    this._muffled = null;
    this._orbit = null; // the orbit's scene (made when first needed)
    this.stats = { trips: 0, landings: 0, lastTrip: null };
    ROCKET_HOOKS.space = this;
    this._makeDom();
    if (typeof window !== "undefined") window.addEventListener("keydown", (e) => this._key(e));
  }

  // A trip in progress (the player is held: no body, no vehicle).
  get busy() {
    return !!this.trip;
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
#space-menu { position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%); display: none; gap: 14px; }
#space-menu .d { width: 150px; padding: 12px 10px 10px; border-radius: 10px; background: rgba(8,14,26,0.72); border: 1px solid rgba(160,200,255,0.35); text-align: center; }
#space-menu .d.here { border-color: rgba(255,220,140,0.55); }
#space-menu .k { display: inline-block; min-width: 22px; padding: 1px 6px; border-radius: 4px; background: #e8eef6; color: #111; font: 700 14px monospace; }
#space-menu .n { font: 700 20px/1.3 "Segoe UI", system-ui, sans-serif; margin-top: 6px; }
#space-menu .s { font: 13px/1.3 "Segoe UI", system-ui, sans-serif; opacity: 0.75; }
#space-title { position: absolute; left: 50%; top: 9%; transform: translateX(-50%); font: 700 22px "Segoe UI", system-ui, sans-serif; letter-spacing: 5px; color: #cfe7ff; display: none; text-shadow: 0 2px 8px #000; }
#space-fade { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; z-index: 29; }
body.space-trip #hud, body.space-trip #vehicle-hud, body.space-trip #vehicle-prompt, body.space-trip #hud-toast, body.space-trip #mission-tracker, body.space-trip #mission-marker, body.space-trip #boss-bar, body.space-trip #missile-warn, body.space-trip #lock-box, body.space-trip #stats-overlay { visibility: hidden; }
`;
    document.head.appendChild(st);
    const el = document.createElement("div");
    el.id = "space-hud";
    el.innerHTML = `<div class="cap count"></div><div class="cap big"></div><div class="cap stage"></div><div class="cap hint"></div><div id="space-title"></div><div id="space-menu"></div>`;
    document.body.appendChild(el);
    const fade = document.createElement("div");
    fade.id = "space-fade";
    document.body.appendChild(fade);
    this.el = el;
    this.fadeEl = fade;
    this.caps = {};
    for (const k of ["count", "big", "stage", "hint"]) this.caps[k] = { el: el.querySelector(`.cap.${k}`), t: 0 };
    this.menuEl = el.querySelector("#space-menu");
    this.titleEl = el.querySelector("#space-title");
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

  _clearCaptions() {
    if (!this.caps) return;
    for (const c of Object.values(this.caps)) {
      c.t = 0;
      c.el.style.opacity = "0";
    }
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
    // (the planets' looks, painted a little each frame from now: ready by orbit)
    if (r === this.vehicles.active) for (const n of ["earth", "earthClouds", "earthNight", "moon", "mars"]) planetTexture(n);
    if (r === this.vehicles.active) this.caption(r.stack === "ship" ? "Lift-off in 3" : "Countdown: T-10", "stage", 2);
  }

  onLiftoff(r) {
    // (Earth's pad: where a ship coming home lands)
    if (!r.puppet && r.pad && this.world.dim === "overworld") this.sites.overworld = r.pad.slice();
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

  // Engine cut-off: the rocket is in orbit. Ours (we're aboard): the trip
  // begins; nobody aboard: it is gone; a puppet: its owner says.
  reachedOrbit(r) {
    if (r.puppet) return;
    const v = this.vehicles;
    if (r !== v.active) {
      v.remove(r);
      return;
    }
    const from = this.world.dim || "overworld";
    this.trip = {
      phase: "insert",
      t: 0,
      from,
      to: null,
      stack: r.stack,
      fromStack: r.pad && from === "overworld" ? "full" : r.pad ? "full" : "ship",
      pad: r.pad ? r.pad.slice() : [r.pos.x, this.world.heightAt(Math.floor(r.pos.x), Math.floor(r.pos.z)) + 1, r.pos.z],
      yaw: r.yaw,
      choice: from === "overworld" ? 0 : 2,
    };
    this.stats.trips++;
    // (the rocket goes: the player rides in the orbit's scene now, held where they are, out of everyone's way)
    v.exit({ force: true });
    v.remove(r);
    this._hold(true);
    this._openOrbit();
    voice.say("rocket_orbit", { text: "Main engine cut off. Orbit insertion" });
  }

  // The ship stood up on its legs.
  landed(r) {
    if (r.puppet) return;
    const dim = this.world.dim || "overworld";
    this.sites[dim] = [Math.round(r.pos.x), Math.round(r.pos.y), Math.round(r.pos.z)];
    this.stats.landings++;
    this.caption(dim === "overworld" ? "Welcome home" : `Welcome to ${NAME_OF[dim] || "space"}`, "big", 3.5);
    this.caption("F: get out · Space: lift off to orbit again", "hint", 6);
  }

  // ---------- The player during a trip ----------

  _hold(on) {
    const p = this.player;
    if (on) {
      this._wasMouse = p.mouseCapture;
      p.mouseCapture = (e) => this._mouse(e.movementX, e.movementY);
      p.enabled = false;
      p.velocity.set(0, 0, 0);
      document.body.classList.add("space-trip");
    } else {
      p.mouseCapture = this._wasMouse ?? null;
      this._wasMouse = null;
      document.body.classList.remove("space-trip");
    }
  }

  _mouse(dx, dy) {
    const o = this._orbit;
    if (!o) return;
    o.camYaw -= dx * 0.003;
    o.camPitch = Math.max(-1.2, Math.min(1.2, o.camPitch + dy * 0.003));
  }

  _key(e) {
    const t = this.trip;
    if (!t || t.phase !== "orbit" || this.game.gameState !== "playing") return;
    const i = DEST.findIndex((d) => d.key === e.code);
    if (i >= 0) {
      e.preventDefault();
      this.choose(DEST[i].dim);
      return;
    }
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      t.choice = (t.choice + (e.code === "ArrowLeft" ? 2 : 1)) % 3;
      this._menu();
    } else if (e.code === "Enter" || e.code === "Space") {
      e.preventDefault();
      this.choose(DEST[t.choice].dim);
    }
  }

  // Where to: "moon" | "mars" | "overworld" (from orbit only).
  choose(dim) {
    const t = this.trip;
    if (!t || t.phase !== "orbit" || !DEST.some((d) => d.dim === dim)) return false;
    if (!this.dims?.enabled && dim !== t.from) {
      this.caption("Space travel needs the dimensions (a world of this kind has none)", "hint", 3);
      return false;
    }
    t.to = dim;
    t.phase = "transfer";
    t.t = 0;
    this.menuEl.style.display = "none";
    this.titleEl.style.display = "none";
    this._clearCaptions();
    const same = dim === t.from;
    this.caption(same ? `Deorbit burn: back to ${NAME_OF[dim]}` : `Transfer burn: to ${NAME_OF[dim]}`, "stage", 3);
    voice.say("rocket_burn", { text: same ? "Deorbit burn" : `Trans ${dim === "overworld" ? "Earth" : dim === "moon" ? "lunar" : "Mars"} injection` });
    // The landing: its place, and the world goes there now (behind the cinematic).
    const site = this._landingSite(dim);
    t.site = site;
    const from = { dim: t.from, x: Math.floor(t.pad[0]) + 6, y: t.pad[1], z: Math.floor(t.pad[2]) };
    const ok = this.dims?.travel?.(dim, site.sx, site.sy, site.sz, { place: "exact", from });
    if (!ok && dim !== this.world.dim) {
      // (refused: back to the pad's planet, the same way down)
      t.to = this.world.dim;
      t.site = this._landingSite(t.to);
    }
    this._hideLoading();
    return true;
  }

  // Where a ship comes down in `dim`: its target (x, z), and where it starts
  // (in the sky, a little off it).
  _landingSite(dim) {
    let x;
    let z;
    const known = this.sites[dim];
    if (known) [x, , z] = known;
    else if (dim === "overworld") {
      const s = this.game.spawn || { x: 0, z: 0 };
      x = s.x + 0.5;
      z = s.z + 0.5;
    } else {
      // (the landing zone: each player a little apart)
      const pid = this.mp?.net?.pid || 1;
      const a = pid * 2.4;
      x = Math.cos(a) * (pid > 1 ? 14 : 4);
      z = Math.sin(a) * (pid > 1 ? 14 : 4);
    }
    const ground = this.world.terrainOf ? this.world.terrainOf(dim).heightAt(Math.floor(x), Math.floor(z)) : 64;
    const h = Number.isFinite(ground) && ground > 0 ? ground : 64;
    return { x, z, sx: x + 22, sy: Math.min(WORLD_HEIGHT + 150, h + 190), sz: z + 8 };
  }

  _hideLoading() {
    const el = typeof document !== "undefined" ? document.getElementById("dim-loading") : null;
    if (el && el.style.display !== "none") el.style.display = "none";
  }

  // The world again: the ship in the sky over the landing site, coming down, the player at the controls.
  _land() {
    const t = this.trip;
    const s = t.site;
    const dim = this.world.dim;
    this._closeOrbit();
    this._hold(false);
    this.trip = null;
    this.stats.lastTrip = { from: t.from, to: dim };
    const p = this.player;
    p.enabled = true;
    const v = this.vehicles.create("rocket", { stack: "ship", phase: "descent", pos: [s.sx, s.sy, s.sz], vel: [-3, -32, -1], target: [s.x, s.z], yaw: t.yaw ?? 0 });
    if (!v) return;
    v.summoned = true;
    v.keep = true;
    this.vehicles.enter(v);
    v.camYaw = Math.PI * 0.25;
    v.camPitch = -0.5; // (from above: the ground coming up)
    this._fade(1, 0);
    this.caption(dim === "overworld" ? "Re-entry: home" : `Descent to ${NAME_OF[dim] || "the surface"}`, "big", 3);
    this.caption("The autopilot lands it — or take over: Space/Shift throttle, W A S D tilt", "hint", 6);
    voice.say("rocket_descent", { text: "Descent engine armed" });
  }

  _fade(from, to, seconds = FADE_T) {
    if (!this.fadeEl) return;
    this.fadeEl.style.transition = "none";
    this.fadeEl.style.opacity = String(from);
    void this.fadeEl.offsetWidth;
    this.fadeEl.style.transition = `opacity ${seconds}s`;
    this.fadeEl.style.opacity = String(to);
  }

  // ---------- The orbit's scene ----------

  _buildOrbit() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0, 0, 0);
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 80000);
    const sun = new THREE.Vector3(-0.35, 0.5, 0.8).normalize(); // (from over the camera's shoulder: the ship and the planets' day sides toward the view)
    // the stars
    const N = 3000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
      if (_v.lengthSq() < 0.01) _v.set(1, 0, 0);
      _v.normalize().multiplyScalar(40000);
      pos.set([_v.x, _v.y, _v.z], i * 3);
      const k = Math.pow(Math.random(), 3) * 2.2 + 0.25;
      const warm = Math.random();
      col.set([k * (0.85 + warm * 0.2), k * 0.92, k * (1.1 - warm * 0.25)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }));
    stars.frustumCulled = false;
    scene.add(stars);
    // the sun: a glare and its halo
    const glowTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.08, "rgba(255,250,235,1)");
      gr.addColorStop(0.25, "rgba(255,220,170,0.35)");
      gr.addColorStop(1, "rgba(255,190,120,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(4, 3.8, 3.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sunSprite.scale.setScalar(5200);
    scene.add(sunSprite);
    const light = new THREE.DirectionalLight(0xffffff, 3.4);
    light.position.copy(sun);
    scene.add(light, light.target);
    scene.add(new THREE.HemisphereLight(0x8aa0c0, 0x2a4a7a, 0.55)); // (the starlight and the planet's glow from below)
    // the ship and the core stage that separates
    const ship = createRocketModel({ standard: true });
    ship.setStack("ship");
    ship.setLegs(0);
    const core = createRocketModel({ standard: true });
    core.setStack("core");
    core.ship.visible = false;
    scene.add(ship.root, core.root);
    // the streaks of a fast coast (faint dust in the light)
    const SN = 220;
    const spos = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) spos.set([rand(-400, 400), rand(-250, 250), rand(-400, 400)], i * 3);
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute("position", new THREE.BufferAttribute(spos, 3));
    const streaks = new THREE.Points(streakGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: new THREE.Color(0.6, 0.65, 0.8), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    streaks.frustumCulled = false;
    scene.add(streaks);
    // the entry's glow (an atmosphere's: round the ship's heat shield)
    const entry = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(3.5, 1.4, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    entry.scale.setScalar(18);
    scene.add(entry);
    this._orbit = { scene, camera, sun, stars, sunSprite, light, ship, core, streaks, entry, planets: {}, camYaw: 0.6, camPitch: 0.15, time: 0 };
  }

  _planet(kind) {
    const o = this._orbit;
    if (!o.planets[kind]) {
      const p = createPlanet(kind, R, o.sun, { segments: 96 });
      o.scene.add(p.group);
      o.planets[kind] = p;
    }
    return o.planets[kind];
  }

  _openOrbit() {
    for (const n of ["earth", "earthClouds", "earthNight", "moon", "mars"]) planetTexture(n);
    pumpPlanetTextures(Infinity); // (whatever is left of them: now)
    this._clearCaptions();
    if (!this._orbit) this._buildOrbit();
    const o = this._orbit;
    const t = this.trip;
    for (const p of Object.values(o.planets)) p.group.visible = false;
    const home = this._planet(PLANET_OF[t.from] || "earth");
    home.group.visible = true;
    home.group.position.set(0, -(R + ORBIT_ALT), 0);
    home.group.scale.setScalar(1);
    o.time = 0;
    o.camYaw = 0;
    o.camPitch = 0;
    o.camInit = false;
    o.look = null;
    o.wasBack = undefined;
    o.core.root.visible = t.stack !== "ship";
    o.ship.setLegs(0);
    this.view = { scene: o.scene, camera: o.camera };
    this._fade(1, 0, 0.5);
    this.caption("MAIN ENGINE CUT-OFF", "big", 2.5);
  }

  _closeOrbit() {
    this.view = null;
    this.menuEl.style.display = "none";
    this.titleEl.style.display = "none";
  }

  _menu() {
    const t = this.trip;
    const here = t.from;
    this.titleEl.textContent = `IN ORBIT ROUND ${(NAME_OF[here] || "EARTH").replace("the ", "").toUpperCase()}`;
    this.titleEl.style.display = "block";
    this.menuEl.innerHTML = DEST.map((d, i) => {
      const back = d.dim === here;
      const sub = back ? "land again" : d.dim === "moon" ? "1/6 gravity · craters" : d.dim === "mars" ? "0.38 gravity · canyons" : "home · the pad";
      const sel = i === t.choice ? ' style="border-color:#ffe08a;background:rgba(40,34,12,0.78)"' : "";
      return `<div class="d${back ? " here" : ""}"${sel}><span class="k">${i + 1}</span><div class="n">${back ? `Back to ${d.label}` : d.label}</div><div class="s">${sub}</div></div>`;
    }).join("");
    this.menuEl.style.display = "flex";
  }

  // The orbit's scene, a frame: the ship, the planets and the camera by
  // phase. The ship stays at the origin, its nose along +X (the way round
  // the orbit, then toward the planet ahead); the planets move round it.
  _animateOrbit(dt) {
    const o = this._orbit;
    const t = this.trip;
    o.time += dt;
    const cam = o.camera;
    const aspect = (window.innerWidth || 16) / (window.innerHeight || 9);
    if (Math.abs(cam.aspect - aspect) > 1e-3) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    const home = this._planet(PLANET_OF[t.from] || "earth");
    home.spin(dt);
    const ship = o.ship;
    ship.root.position.set(0, 0, 0);
    ship.root.quaternion.setFromAxisAngle(_v.set(0, 0, 1), -Math.PI / 2);
    let shipPower = 0;
    // where the camera wants to be, what it looks at (the mouse turns it round that)
    const want = _v.set(-26, 9, 30);
    const look = _v2.set(6, -1, 0);
    let free = 0.35; // (how far the mouse may turn it, radians)
    if (t.phase === "insert") {
      const k = t.t;
      // the stack together, the core burning out, then apart (the core falls back and tumbles), the ship's engine lights
      const sep = smooth(1.2, 1.4, k);
      const d = Math.max(0, k - 1.2);
      o.core.root.position.set(-CORE_OFFSET - d * d * 1.6 - d * 2, -d * 0.8, -d * 0.4);
      o.core.root.quaternion.setFromAxisAngle(_v3.set(0.2, 0.3, 1).normalize(), -Math.PI / 2 + sep * d * 0.22);
      o.core.setFlames({ core: k < 1.2 ? 1 : 0, boost: 0, ship: 0 }, o.time, 1);
      shipPower = k > 1.8 && k < 4.6 ? 1 : 0;
      if (k > 1.25 && k < 1.35) this.caption("Stage separation", "stage", 2.5);
      if (k > 1.8 && k < 1.9) this.caption("Second engine start", "stage", 2);
      want.set(-30 - k * 2, 7 + k, 26 + k * 2);
      look.set(-4 + k * 1.5, -2, 0);
      if (k >= INSERT_T) {
        t.phase = "orbit";
        t.t = 0;
        this.caption(`ORBIT REACHED`, "big", 3);
        this._menu();
      }
    } else if (t.phase === "orbit") {
      if (o.core.root.visible) {
        o.core.root.position.x -= dt * 7;
        o.core.root.position.y -= dt * 1.2;
        o.core.root.rotateZ(dt * 0.06);
      }
      // (drifting round the ship; the mouse turns the view all the way round)
      o.camYaw += dt * 0.035;
      want.set(Math.sin(o.camYaw) * 34 + 6, 8, Math.cos(o.camYaw) * 34);
      look.set(6, -4, 0);
      free = Math.PI;
    } else if (t.phase === "transfer") {
      const k = Math.min(1, t.t / TRANSFER_T);
      o.core.root.visible = false;
      shipPower = t.t < 3.2 ? 1 : 0;
      // The planet left behind falls away and shrinks (first: the camera
      // ahead of the ship, looking back at the burn and the planet); the new
      // one comes up ahead (then: from behind the ship, looking where it goes).
      const away = smooth(0.02, 0.8, k);
      const to = this._planet(PLANET_OF[t.to] || "earth");
      to.group.visible = true;
      const back = k < 0.38;
      if (to !== home) {
        home.group.position.set(-away * 6000, -(R + ORBIT_ALT) - away * 900, -away * 1500);
        to.spin(dt);
        const come = smooth(0.3, 1, k);
        // (along the line ahead of the ship, from far off to just below it)
        const D = THREE.MathUtils.lerp(15000, 0, come);
        to.group.position.set(520 + D, -(R + 220) + D * 0.08, -60 - D * 0.05);
      } else {
        // (the same planet: the deorbit burn turns the ship down toward it)
        home.group.position.set(0, -(R + ORBIT_ALT) + k * 40, 0);
      }
      o.streaks.material.opacity = back ? 0 : Math.sin(smooth(0.38, 1, k) * Math.PI) * 0.6;
      const sp = o.streaks.geometry.getAttribute("position");
      for (let i = 0; i < sp.count; i++) {
        let x = sp.getX(i) - dt * 900;
        if (x < -400) x += 800;
        sp.setX(i, x);
      }
      sp.needsUpdate = true;
      if (back) {
        want.set(46, 7, 16);
        look.set(-30, -60, -10);
      } else {
        const kk = smooth(0.38, 1, k);
        want.set(-36 + 6 * kk, 10 - 2 * kk, 14);
        // (between the ship and the planet ahead: both in the picture)
        _v3.copy(to.group.position).sub(want).normalize().multiplyScalar(140).add(want);
        look.set(30, 0, 0).lerp(_v3, 0.55);
      }
      if (back !== o.wasBack) {
        // (a cut, not a swing: the second shot starts where it is)
        if (o.wasBack !== undefined) o.camInit = false;
        o.wasBack = back;
      }
      if (k >= 1 && (!this.dims?.pending || t.t > TRANSFER_T + 20)) {
        t.phase = "approach";
        t.t = 0;
        this.caption(`Approaching ${NAME_OF[t.to] || "the surface"}`, "stage", 3);
      } else if (k >= 1) this.caption("Plotting the landing...", "hint", 0.5);
    } else if (t.phase === "approach") {
      const k = Math.min(1, t.t / APPROACH_T);
      const to = this._planet(PLANET_OF[t.to] || "earth");
      to.spin(dt);
      if (to !== home) home.group.visible = false;
      // down toward the surface: it comes up under the ship
      to.group.position.set(520 - k * 120, -(R + 220) + k * 180, -60);
      // the ship turning engine-first, the burn lighting, the legs coming out
      const flip = smooth(0.1, 0.55, k);
      ship.root.quaternion.setFromAxisAngle(_v3.set(0, 0, 1), -Math.PI / 2 + flip * Math.PI * 0.5);
      shipPower = k > 0.5 ? 1 : 0;
      ship.setLegs(smooth(0.7, 1, k));
      const air = PLANET_OF[t.to] !== "moon";
      o.entry.material.opacity = air ? Math.sin(smooth(0, 0.6, k) * Math.PI) * 0.9 : 0;
      o.entry.position.set(6 * (1 - flip), -1 - flip, 0);
      o.streaks.material.opacity = 0;
      want.set(-14 + 10 * k, 12 - 6 * k, 30 - 6 * k);
      look.set(4, -10 - 6 * k, 0);
      if (k >= 1 - FADE_T / APPROACH_T && !t.faded) {
        t.faded = true;
        this._fade(0, 1);
      }
      if (k >= 1) this._land();
    }
    ship.setFlames({ core: 0, boost: 0, ship: shipPower }, o.time, 1);
    // the mouse's turn round the look point (in orbit all the way round; else a little)
    if (t.phase !== "orbit") {
      o.camYaw = THREE.MathUtils.clamp(o.camYaw, -free, free);
      o.camPitch = THREE.MathUtils.clamp(o.camPitch, -free, free);
      _v3.copy(want).sub(look).applyAxisAngle(_q2a.set(0, 1, 0), o.camYaw * 0.5);
      want.copy(look).add(_v3);
    }
    want.y += o.camPitch * 12;
    if (!o.camInit) {
      o.camInit = true;
      cam.position.copy(want);
      o.look = new THREE.Vector3().copy(look);
    } else cam.position.lerp(want, Math.min(1, dt * 1.8));
    o.look = (o.look || new THREE.Vector3().copy(look)).lerp(look, Math.min(1, dt * 2.5));
    cam.lookAt(o.look);
    o.stars.position.copy(cam.position);
    o.sunSprite.position.copy(cam.position).addScaledVector(o.sun, 30000);
  }

  // Draws the orbit's scene (main.js renderFrame, while `view` is set).
  render(renderer, postfx = null) {
    const v = this.view;
    if (!v) return false;
    if (postfx) {
      postfx.render(v.scene, v.camera, { exposure: 1, raysStrength: 0, bloomStrength: 0.22, night: 0, time: this._orbit?.time ?? 0 }, null);
    } else {
      renderer.toneMappingExposure = 1;
      renderer.setRenderTarget(null);
      renderer.render(v.scene, v.camera);
    }
    return true;
  }

  // ---------- Every frame ----------

  update(dt) {
    this._captions(dt);
    pumpPlanetTextures(3);
    // the climb's sky: by the eye's height over the ground in the Overworld
    const cam = this.game.camera;
    const dim = this.world.dim || "overworld";
    let k = 0;
    if (dim === "overworld" && cam && !this.trip) k = smooth(150, 560, cam.position.y - 64);
    this.sky.altK += (k - this.sky.altK) * Math.min(1, dt * 3);
    this._debris(dt);
    this._muffle(dim);
    if (dim === "mars" && !this.trip) this._dustDevils(dt);
    else if (this.devils.length) this.devils.length = 0;
    const t = this.trip;
    // (alone, the pause menu holds the trip where it is, as it holds the world)
    if (t && this.game.gameState === "paused" && !this.mp?.active) return;
    if (t) {
      t.t += dt;
      // (the player held, out of the world: no fall, no hunger's walk)
      const p = this.player;
      p.enabled = false;
      p.velocity.set(0, 0, 0);
      if (this.dims?.pending) this._hideLoading();
      if (this._orbit && this.view) this._animateOrbit(dt);
      if (p.dead) this.abort();
    }
  }

  // Back from a trip at once (death, a mode change...): the world as it is.
  abort() {
    if (!this.trip) return;
    this._closeOrbit();
    this._hold(false);
    this.trip = null;
    this.player.enabled = true;
    this._fade(0, 0, 0.01);
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
  // voice and the menus' sounds as ever.
  _muffle(dim) {
    const a = this.game.audio;
    if (!a?.ctx || !a.buses) return;
    const want = !!this.world.dimInfo?.airless;
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
  // dimensions'): the sites; in the middle of a trip, the place it began
  // (the pad's side) and the rocket to put back there.
  serialize() {
    const out = {};
    const sites = Object.keys(this.sites).length ? this.sites : undefined;
    const t = this.trip;
    if (!t) return sites ? { space: { sites } } : {};
    const pos = [Math.floor(t.pad[0]) + 6.5, t.pad[1] + 0.05, Math.floor(t.pad[2]) + 0.5];
    out.pos = pos;
    out.dim = t.from !== "overworld" ? t.from : undefined;
    out.space = { sites, trip: { from: t.from, pad: t.pad, stack: t.fromStack, yaw: t.yaw } };
    return out;
  }

  // From the player's save (after the dimensions': the world is already in
  // the dimension it was saved in).
  init(saved) {
    if (!saved || typeof saved !== "object") return;
    if (saved.sites && typeof saved.sites === "object") {
      for (const [dim, p] of Object.entries(saved.sites)) if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) && PLANET_OF[dim]) this.sites[dim] = p.slice();
    }
    const t = saved.trip;
    if (t && Array.isArray(t.pad) && t.pad.length === 3 && t.pad.every(Number.isFinite)) {
      // (saved mid-trip: back at the pad, the rocket on it as it was)
      const full = t.stack === "full";
      const v = this.vehicles.create("rocket", { stack: full ? "full" : "ship", phase: full ? "pad" : "landed", pos: t.pad.slice(), pad: full ? t.pad.slice() : undefined, tower: full, yaw: Number.isFinite(t.yaw) ? t.yaw : 0, summoned: true });
      if (v) this.caption("The trip was cut short: back at the pad", "hint", 4);
    }
  }
}

const CORE_OFFSET = 25.4; // (the core's bottom behind the ship's: js/rocket.js CORE_TOP - SHIP_LIFT)
const DEBRIS_SMOKE = new THREE.Color(0.8, 0.79, 0.78);
const DEBRIS_SMOKE2 = new THREE.Color(0.6, 0.6, 0.6);
const DEVIL = new THREE.Color(0.68, 0.4, 0.25);
const DEVIL2 = new THREE.Color(0.55, 0.32, 0.2);
