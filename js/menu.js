// Menus around the game: the main menu (logo, Play / New World / Settings /
// Mods / Controls) over a slow camera flyover of the world with a UFO
// drifting across the sky, and the sub-screens shared by the main menu and
// the pause menu (settings, mods, controls, stats). Opening a sub-screen
// hides the menu it came from; Back (or Esc) returns to it.
import * as THREE from "three";
import { createUfoModel } from "./ufo-models.js";

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
  ]],
  ["Weapons (Mods on)", [
    ["Grenade", "Hold right click to charge, release to throw"],
    ["Pistol", "Right click fires"],
    ["Bazooka", "Right click fires; hold with a target near the crosshair to lock on, release to launch a homing rocket"],
    ["Railgun", "Hold right click ~1 s to charge: one beam through everything (blocks, creatures, UFOs)"],
    ["Laser minigun", "Hold right click: the barrels spin up, then a huge stream of laser bolts"],
    ["Energy shield", "Hold right click to raise it: soaks explosions and attacks while its energy lasts"],
    ["Machine gun", "Hold right click for automatic fire"],
    ["Sniper rifle", "Right click scopes in and out, left click fires"],
    ["Laser blaster", "Right click fires (hold for repeat); color in Settings > Weapons"],
    ["Airstrike", "Aim the laser, right click: meteors rain down after a delay"],
  ]],
  ["Vehicles (Mods on)", [
    ["F", "Board a vehicle nearby / get out (in the air: eject with a parachute)"],
    ["J", "Call in your fighter jet (or right click with the Jet Radio)"],
    ["F5", "Vehicle camera views"],
  ]],
  ["Your UFO", [
    ["Mouse", "Look and steer"],
    ["W / S", "Fly along the view / back"],
    ["A / D", "Sideways"],
    ["Space / Shift", "Up / down"],
    ["Mouse wheel", "Cruising speed (slow hover to extremely fast)"],
    ["Ctrl", "Boost"],
    ["Left click", "Laser cannon"],
    ["Right click (hold)", "Tractor beam"],
  ]],
  ["Fighter jet", [
    ["Mouse", "Steer (flight assist: fly toward the crosshair)"],
    ["W / S", "Throttle up / down"],
    ["Shift", "Afterburner"],
    ["A / D", "Roll"],
    ["Q / E", "Rudder (yaw)"],
    ["Space", "Air brake / wheel brakes"],
    ["Left click", "Autocannon"],
    ["Right click", "Missile (locks onto UFOs and creatures held in front of the nose)"],
    ["B", "Drop the nuke (it falls on a parachute: get clear!)"],
    ["F", "Get out on the ground, eject in the air"],
  ]],
  ["Game", [
    ["Esc", "Pause menu (settings, mods, stats)"],
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

// The main menu's animated background: the camera glides in a slow circle
// high over the start of the world, looking out over the land, while a UFO
// drifts across the sky every so often.
export class MenuFlyover {
  constructor(scene, world) {
    this.world = world;
    this.scene = scene;
    this.time = 0;
    this.center = new THREE.Vector3();
    this.ufo = createUfoModel("saucer", 5.5, { castShadow: false });
    this.ufo.root.visible = false;
    scene.add(this.ufo.root);
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._pass = -1;
    this._look = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this.active = false;
  }

  setCenter(v) {
    this.center.copy(v);
  }

  _groundAt(x, z) {
    const y = this.world.surfaceY(Math.floor(x), Math.floor(z));
    return y >= 0 ? y : this.world.heightAt(Math.floor(x), Math.floor(z));
  }

  update(dt, camera, night = 0) {
    this.active = true;
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

    // A UFO passes across the view every ~34 s.
    const PERIOD = 34;
    const DUR = 24;
    const pass = Math.floor((t + 20) / PERIOD);
    const u = ((t + 20) % PERIOD) / DUR;
    const ufo = this.ufo;
    if (pass !== this._pass) {
      this._pass = pass;
      const fwd = this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const dir = pass % 2 === 0 ? 1 : -1;
      const base = camera.position.clone().addScaledVector(fwd, 95 + Math.random() * 25);
      this._from.copy(base).addScaledVector(right, -160 * dir).add(new THREE.Vector3(0, 4 + Math.random() * 8, 0));
      this._to.copy(base).addScaledVector(right, 160 * dir).add(new THREE.Vector3(0, 14 + Math.random() * 10, 0));
    }
    if (u <= 1) {
      ufo.root.visible = true;
      // Slow in the middle (it pauses to "look"), faster at the ends.
      const s = u + Math.sin(u * Math.PI * 2) * -0.08;
      ufo.root.position.lerpVectors(this._from, this._to, s);
      ufo.root.position.y += Math.sin(t * 1.3) * 1.2;
      ufo.body.rotation.z = Math.sin(t * 0.9) * 0.08;
      ufo.body.rotation.y = t * 0.8;
      ufo.animate(t, { night: 0.35 + 0.65 * night });
    } else {
      ufo.root.visible = false;
    }
  }

  hide() {
    this.active = false;
    this.ufo.root.visible = false;
  }
}
