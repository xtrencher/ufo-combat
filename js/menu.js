// Menus around the game: the main menu (logo, Play / New World / Settings /
// Mods / Controls) over a slow camera flyover of the world with a UFO
// drifting across the sky, and the sub-screens shared by the main menu and
// the pause menu (settings, mods, controls, stats). Opening a sub-screen
// hides the menu it came from; Back (or Esc) returns to it.
import * as THREE from "three";
import { createUfoModel, randomUfoSpec } from "./ufo-models.js";

// The controls reference: [section, [[keys, action], ...]].
export const CONTROLS = [
  ["On foot", [
    ["W A S D", "Move"],
    ["Mouse", "Look around"],
    ["Space", "Jump / swim up (double-tap to fly in Creative)"],
    ["Ctrl or double-tap W", "Sprint"],
    ["Shift", "Sneak (won't walk off edges) / fly down"],
    ["Left click", "Mine a block / attack (hold to keep mining)"],
    ["Right click", "Place a block / use / eat / fire the weapon in hand"],
    ["Both mouse buttons (hold)", "Binoculars: a strong zoom (strength in Settings > Controls)"],
    ["1-9 / mouse wheel", "Pick a hotbar slot"],
    ["E", "Inventory (all items in Creative)"],
    ["Q", "Drop the held item (whole stack with Ctrl)"],
    ["Middle click", "Pick the targeted block (Creative)"],
    ["F11 or Alt+Enter", "Fullscreen (or the corner button, top right, when the mouse is free). In Chromium browsers fullscreen also locks the keyboard, so Ctrl+W, Ctrl+R and the like reach the game; hold Esc to leave fullscreen then"],
  ]],
  ["Weapons (Mods on)", [
    ["Grenade", "Hold right click to charge, release to throw"],
    ["Pistol", "Right click fires"],
    ["Bazooka", "Right click fires; hold with a target near the crosshair to lock on, release to launch a homing rocket"],
    ["Railgun", "Hold right click ~1 s to charge: one beam through everything (blocks, creatures, UFOs)"],
    ["Laser minigun", "Hold right click: the barrels spin up, then a huge stream of laser bolts"],
    ["Bow", "Hold right click to draw (about 1 s for full power), let go to shoot"],
    ["Armor", "Right click a piece in hand to put it on (or use the four armor slots in the inventory): it turns away damage and wears out"],
    ["R", "Reload the weapon in hand (magazines reload by themselves when empty)"],
    ["Machine gun", "Hold right click for automatic fire"],
    ["Sniper rifle", "Right click scopes in and out, left click fires"],
    ["Laser blaster", "Right click fires (hold for repeat); color in Settings > Weapons"],
    ["Airstrike", "Aim the laser, right click: meteors rain down after a delay"],
  ]],
  ["Vehicles (Mods on)", [
    ["F", "Board a vehicle nearby / get out (in the air: eject with a parachute)"],
    ["Airports", "Jets are not called in: walk to a jet parked at an airport (F3 shows the nearest) and press F to climb in"],
    ["F5", "Vehicle camera views"],
    ["I", "Stats and controls of the vehicle you are in"],
  ]],
  ["Your UFO", [
    ["Mouse", "Look and steer"],
    ["W / S", "Fly along the view / back"],
    ["A / D", "Sideways"],
    ["Space / Shift", "Up / down"],
    ["Mouse wheel", "Cruising speed (slow hover to extremely fast)"],
    ["Ctrl", "Boost"],
    ["Left click", "The ship's own weapon, the way its kind fights (rapid bursts, heavy plasma, a spread fan, charged shots, a sweeping beam, seekers or pulse bolts; all aimed at the crosshair)"],
    ["Right click (hold)", "Tractor beam"],
    ["R", "Teleport dash: the ship streaks along the view in a split second; hold R to keep streaking (no distance limit). Distance and travel time, or off, in Settings > Vehicles"],
    ["B", "Superweapon: after a short charge, a huge laser straight down"],
  ]],
  ["Fighter jet", [
    ["Mouse", "Steer (flight assist: fly toward the crosshair)"],
    ["W / S", "Throttle up / down (a takeoff roll takes about 120 blocks, 90 in the F-16: use a runway)"],
    ["Shift", "Afterburner"],
    ["A / D", "Bank harder (flight assist; without it: roll)"],
    ["Q / E", "Rudder (yaw)"],
    ["Space (hold)", "Air brakes: panels (F-16) or control surfaces (F-22) open, the jet sheds speed very fast and turns much tighter; too slow and it stalls. On the ground: wheel brakes"],
    ["Left click", "Autocannon (aims a little for you; overheats: watch the heat bar)"],
    ["Right click", "Unguided missile, straight ahead"],
    ["Right click (hold)", "Missile lock on the UFO or enemy aircraft nearest the view centre (ones attacking you first), even behind you; release after 1 s: one missile, longer: a salvo (4 from the F-22, 2 from the F-16). The view follows the target until the hit; right click brings it back. Let go before LOCKED: nothing fires"],
    ["C", "Flares: fool missiles and seeking shots"],
    ["B", "Drop the nuke (it falls on a parachute: get clear!)"],
    ["F", "Get out on the ground, eject in the air"],
  ]],
  ["Game", [
    ["Esc", "Pause menu (settings, mods, missions, stats)"],
    ["F1", "Hide the HUD"],
    ["F3", "Debug info"],
    ["F5", "Camera: first person / behind / in front"],
  ]],
];

// Extra sections added later (vehicles fill in their own controls).
export function renderControls(el, extra = []) {
  const sections = [...CONTROLS, ...extra];
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  el.innerHTML = sections
    .map(([title, rows]) => `<h3>${esc(title)}</h3><table>${rows.map(([k, a]) => `<tr><td>${esc(k)}</td><td>${esc(a)}</td></tr>`).join("")}</table>`)
    .join("");
}

export class MenuScreens {
  constructor() {
    this.stack = []; // ids of the screens under the current one
    this.current = null;
    this.onOpen = {}; // id -> fn() (refresh contents when shown)
    for (const btn of document.querySelectorAll(".back-btn")) btn.addEventListener("click", () => this.back());
  }

  get open() {
    return this.current !== null;
  }

  // Shows sub-screen `id` over `from` (the element id of the menu it was
  // opened from, which is hidden meanwhile).
  show(id, from) {
    if (this.current) {
      document.getElementById(this.current).classList.add("hidden");
      this.stack.push(this.current);
    } else if (from) {
      document.getElementById(from).classList.add("hidden");
      this.stack.push(from);
    }
    this.current = id;
    document.getElementById(id).classList.remove("hidden");
    this.onOpen[id]?.();
  }

  back() {
    if (!this.current) return false;
    document.getElementById(this.current).classList.add("hidden");
    const prev = this.stack.pop() || null;
    if (prev) document.getElementById(prev).classList.remove("hidden");
    // Only sub-screens are "current"; the start and pause menus are not.
    this.current = prev && prev !== "start-menu" && prev !== "pause-menu" ? prev : null;
    if (!this.current) this.stack.length = 0;
    return true;
  }

  // Closes every sub-screen without showing what was under them.
  closeAll() {
    if (this.current) document.getElementById(this.current).classList.add("hidden");
    for (const id of this.stack) if (id !== "start-menu" && id !== "pause-menu") document.getElementById(id).classList.add("hidden");
    this.stack.length = 0;
    this.current = null;
  }
}

// Tips shown (one at a time, rotating) at the bottom of the main menu.
export const MENU_TIPS = [
  "Survival starts with a sword: skeletons drop bows, supply crates bring guns, alien leaders carry alien weapons.",
  "Supply crates drop by parachute with orange smoke: walk up to open one.",
  "Hold the right mouse button with the bazooka to lock on; release for a homing rocket.",
  "The railgun's beam goes through everything: blocks, creatures and UFOs.",
  "Press J to call a fighter jet (1: F-22, 2: F-16). Airports have long runways: much easier to take off from.",
  "In the jet, tap right click for an unguided missile, or hold it to lock: 1 second for one, longer for a salvo.",
  "Press C in the jet for flares: they fool missiles and seeking shots.",
  "Press I in any vehicle for its stats and controls.",
  "A UFO shot down over land may crash in one piece: board it with F and fly it yourself (in Survival from the Salvage mission).",
  "In your own UFO: R dashes you forward (hold it to keep going), B fires a huge laser straight down.",
  "Armor drops from aliens, guards and zombies now and then: put it on with a right click. Better material, less damage taken.",
  "Golden apples add extra hearts on top of your health.",
  "UFOs are mostly peaceful: they turn hostile if you shoot them or stare at them too long.",
  "Patrol fighters hunt UFOs and leave you alone, unless you shoot at one of them.",
];

// The main menu's frame rate readout and its low-FPS advice: a live counter,
// and after a few seconds of measuring, a suggestion to lower the graphics
// preset if the menu itself runs poorly.
export class MenuPerf {
  constructor({ fpsEl, recEl, recTextEl, recBtn, tipEl, onApply }) {
    this.fpsEl = fpsEl;
    this.recEl = recEl;
    this.recTextEl = recTextEl;
    this.recBtn = recBtn;
    this.tipEl = tipEl;
    this.onApply = onApply;
    this.preset = "ultra";
    this.suggest = null;
    this.reset();
    this._tip = Math.floor(Math.random() * MENU_TIPS.length);
    this._tipT = 0;
    if (recBtn) recBtn.addEventListener("click", () => this.suggest && this.onApply && this.onApply(this.suggest));
  }

  reset() {
    this.time = 0;
    this.frames = 0;
    this.acc = 0;
    this.samples = [];
    this.fps = 0;
    this.suggest = null;
    if (this.recEl) this.recEl.classList.add("hidden");
  }

  // The preset to suggest for a measured frame rate, or null when it is fine
  // (about 40 FPS is the goal; each step down is roughly 1.5x faster).
  static recommend(preset, fps, order = ["low", "medium", "high", "ultra"]) {
    const i = order.indexOf(preset);
    if (i <= 0 || !(fps > 0) || fps >= 40) return null;
    const steps = Math.max(1, Math.ceil(Math.log(40 / fps) / Math.log(1.5)));
    const j = Math.max(0, i - steps);
    return j < i ? order[j] : null;
  }

  update(dt, preset) {
    if (preset !== this.preset) {
      this.preset = preset;
      this.reset();
    }
    this.time += dt;
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      if (this.fpsEl) {
        const f = Math.round(this.fps);
        this.fpsEl.textContent = `FPS ${f}`;
        this.fpsEl.classList.toggle("warn", f < 40 && f >= 24);
        this.fpsEl.classList.toggle("bad", f < 24);
      }
      // After a warm-up (shaders and chunks settling), measure for a few seconds.
      if (this.time > 3) this.samples.push(this.fps);
      if (this.samples.length === 8 && !this.suggest && this.recEl) {
        const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        const rec = MenuPerf.recommend(this.preset, avg);
        if (rec) {
          this.suggest = rec;
          const name = rec[0].toUpperCase() + rec.slice(1);
          this.recTextEl.textContent = `The menu runs at only ${Math.round(avg)} FPS on ${this.preset[0].toUpperCase() + this.preset.slice(1)}. ${name} graphics will run much smoother.`;
          this.recBtn.textContent = `Use ${name}`;
          this.recEl.classList.remove("hidden");
        } else if (this.preset === "low" && avg < 30) {
          this.recTextEl.textContent = `Only ${Math.round(avg)} FPS even on Low: try a smaller render distance in Settings.`;
          this.recBtn.textContent = "OK";
          this.recEl.classList.remove("hidden");
        }
      }
    }
    // Rotate the tips.
    this._tipT -= dt;
    if (this._tipT <= 0 && this.tipEl) {
      this._tipT = 8;
      this.tipEl.textContent = `Tip: ${MENU_TIPS[this._tip % MENU_TIPS.length]}`;
      this._tip++;
    }
  }
}

// The main menu's animated background: the camera glides in a slow circle
// high over the start of the world, looking out over the land, while a UFO
// (a different one each time: saucers, spheres, all sorts) crosses the sky.
// It can be shot: click it (a few hits and it blows up, then the next one
// comes by sooner).
export class MenuFlyover {
  constructor(scene, world, { effects = null, audio = null } = {}) {
    this.world = world;
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;
    this.time = 0;
    this.center = new THREE.Vector3();
    this.ufo = null;
    this.radius = 5.5;
    this.health = 4;
    this.score = 0;
    this.onScore = null; // (n) => void
    this.dead = false;
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._camera = null;
    this._passT = -1; // seconds into the current pass (< 0: waiting)
    this._gap = 4; // seconds until the next pass starts
    this._boost = 0;
    this._flash = 0;
    this._ray = new THREE.Ray();
    this._sphere = new THREE.Sphere();
    this._pt = new THREE.Vector3();
    this._c = { hot: new THREE.Color(4, 2.6, 1), dark: new THREE.Color(0.18, 0.17, 0.16), light: new THREE.Color(0.55, 0.53, 0.5), hull: new THREE.Color(0.55, 0.62, 0.7) };
    this.active = false;
  }

  setCenter(v) {
    this.center.copy(v);
  }

  _groundAt(x, z) {
    const y = this.world.surfaceY(Math.floor(x), Math.floor(z));
    return y >= 0 ? y : this.world.heightAt(Math.floor(x), Math.floor(z));
  }

  // A fresh saucer (or sphere, or ...) for the next pass.
  _newUfo() {
    if (this.ufo) {
      this.scene.remove(this.ufo.root);
      this.ufo.dispose?.();
    }
    this.radius = 4 + Math.random() * 3.5;
    this.ufo = createUfoModel(randomUfoSpec(Math.random), this.radius, { castShadow: false });
    this.ufo.root.visible = false;
    this.scene.add(this.ufo.root);
    this.health = 4;
    this.dead = false;
  }

  update(dt, camera, night = 0) {
    this.active = true;
    this._camera = camera;
    this.time += dt;
    const t = this.time;
    const R = 30;
    const a = t * 0.028;
    const c = this.center;
    const x = c.x + Math.cos(a) * R;
    const z = c.z + Math.sin(a) * R;
    // Keep well above whatever is below and around.
    let ground = this._groundAt(x, z);
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) ground = Math.max(ground, this._groundAt(x + dx, z + dz));
    const targetY = Math.max(ground, c.y) + 16 + Math.sin(t * 0.13) * 3;
    if (!this._camY) this._camY = targetY;
    this._camY += (targetY - this._camY) * Math.min(1, dt * 0.6);
    camera.position.set(x, this._camY, z);
    // Look along the circle and a little outward, gently down at the land.
    const ahead = a + 0.55;
    this._look.set(c.x + Math.cos(ahead) * R * 2.2, this._camY - 12, c.z + Math.sin(ahead) * R * 2.2);
    camera.rotation.order = "YXZ";
    const d = this._look.clone().sub(camera.position);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    camera.rotation.set(pitch, yaw, Math.sin(t * 0.2) * 0.02);
    camera.updateMatrixWorld(true);

    // A UFO crosses the view: a pass lasts ~22 s, with a few seconds between.
    const DUR = 22;
    if (this._passT < 0) {
      this._gap -= dt;
      if (this._gap <= 0) {
        this._newUfo();
        const fwd = this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        this._dir = this._dir === 1 ? -1 : 1;
        const base = camera.position.clone().addScaledVector(fwd, 85 + Math.random() * 25);
        this._from.copy(base).addScaledVector(right, -150 * this._dir).add(new THREE.Vector3(0, 4 + Math.random() * 8, 0));
        this._to.copy(base).addScaledVector(right, 150 * this._dir).add(new THREE.Vector3(0, 14 + Math.random() * 10, 0));
        this._passT = 0;
      }
    }
    const ufo = this.ufo;
    if (this._passT >= 0 && ufo) {
      this._boost = Math.max(0, this._boost - dt);
      this._flash = Math.max(0, this._flash - dt * 4);
      this._passT += dt * (1 + this._boost * 1.2);
      const u = this._passT / DUR;
      if (u > 1) {
        this._passT = -1;
        this._gap = 5 + Math.random() * 3;
        ufo.root.visible = false;
      } else {
        ufo.root.visible = !this.dead;
        // Slow in the middle (it pauses to "look"), faster at the ends.
        const s = u + Math.sin(u * Math.PI * 2) * -0.08;
        ufo.root.position.lerpVectors(this._from, this._to, s);
        ufo.root.position.y += Math.sin(t * 1.3) * 1.2;
        ufo.body.rotation.z = Math.sin(t * 0.9) * 0.08 + this._boost * 0.25;
        ufo.body.rotation.y = t * 0.8;
        ufo.light.flash?.setRGB(this._flash * 0.9, this._flash * 0.25, 0);
        ufo.animate(t, { night: 0.35 + 0.65 * night, damage: 1 - this.health / 4, angry: this._boost > 0 ? 1 : 0 });
      }
    }
  }

  get ufoVisible() {
    return !!this.ufo && this.ufo.root.visible && !this.dead;
  }

  // Whether a screen point (normalized device coordinates) is over the UFO.
  hovering(ndcX, ndcY) {
    return !!this._hit(ndcX, ndcY);
  }

  _hit(ndcX, ndcY) {
    if (!this.ufoVisible || !this._camera) return null;
    const cam = this._camera;
    const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
    this._ray.set(cam.position, dir);
    // A little forgiving: it is a small target far away.
    this._sphere.set(this.ufo.root.position, this.radius * 1.5 + 2);
    return this._ray.intersectSphere(this._sphere, this._pt);
  }

  // Fire at a screen point. Returns { hit, killed } (or null when the shot missed).
  shoot(ndcX, ndcY) {
    const at = this._hit(ndcX, ndcY);
    if (!at) return null;
    const fx = this.effects;
    const p = this.ufo.root.position;
    this.health--;
    this._flash = 1;
    this._boost = 1.6; // it jinks away
    if (fx) {
      for (let i = 0; i < 10; i++) fx.glow.spawn({ x: at.x, y: at.y, z: at.z, vx: (Math.random() - 0.5) * 12, vy: Math.random() * 8, vz: (Math.random() - 0.5) * 12, life: 0.35, size0: 0.5, size1: 0.08, color0: this._c.hot, gravity: 0.4, drag: 2 });
    }
    this.audio?.playUfoHit?.(70);
    if (this.health > 0) return { hit: true, killed: false };
    // Down: it blows up (light, sparks, smoke, hull pieces) and the next one comes sooner.
    this.dead = true;
    this.ufo.root.visible = false;
    this.score++;
    this._passT = -1;
    this._gap = 3;
    if (fx) {
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = (Math.random() - 0.5) * Math.PI;
        const sp = 5 + Math.random() * 20;
        fx.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, life: 0.5 + Math.random() * 0.7, size0: 1.5 + Math.random() * 2.5, size1: 0.2, color0: this._c.hot, gravity: 0.3, drag: 1.4 });
      }
      for (let i = 0; i < 16; i++) fx.smoke.spawn({ x: p.x + (Math.random() - 0.5) * 3, y: p.y + (Math.random() - 0.5) * 3, z: p.z + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5, vz: (Math.random() - 0.5) * 5, life: 2 + Math.random() * 1.5, size0: 1.5, size1: 7, color0: this._c.dark, color1: this._c.light, alpha: 0.6, drag: 1 });
      for (let i = 0; i < 16; i++) fx.debris.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 22, (Math.random() - 0.3) * 18, (Math.random() - 0.5) * 22, 0.3 + Math.random() * 0.4, this._c.hull, 2 + Math.random() * 2);
      if (fx.flashLight) {
        fx.flashLight.position.copy(p);
        fx.flashLight.distance = 90;
        fx._flashPower = 500;
        fx._flashTime = 0;
      }
    }
    this.audio?.playExplosion?.(70);
    if (this.onScore) this.onScore(this.score);
    return { hit: true, killed: true };
  }

  hide() {
    this.active = false;
    if (this.ufo) this.ufo.root.visible = false;
  }
}
