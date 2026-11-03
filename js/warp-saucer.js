// The Warp Saucer (Round 16): a UFO with a warp drive, the way to cross the
// solar system under your own control. It flies as any UFO (js/vehicle-
// ufo.js: a domed saucer, its data's `warp`), dressed in its own look: a
// glowing drive ring round its rim, two warp nacelles on struts, blue
// running lights. Out in space (js/solar.js) J lights the drive: the ring
// spins up and glows white-blue, the stars stretch into streaks, a tunnel
// of light, a deep hum rising to a roar; the wheel sets the warp factor
// (1c to 10,000c), the mouse steers, the drive slows near a planet and
// drops out by itself in front of it. In the world J only says where it
// works.
//
// Where to get it: Creative's call-ins (the pause menu's "Warp Saucer"),
// the Vehicles tab's item (js/content/space.js).
import * as THREE from "three";
import { VehicleManager } from "./vehicles.js";
import { UFO_HOOKS } from "./vehicle-ufo.js";

const RING_IDLE = new THREE.Color(0.25, 0.55, 1.4);
const RING_WARP = new THREE.Color(2.4, 3.2, 5.0);

// The drive's parts, sized to the ship (radius r), on its body (they turn
// and tilt with it).
function addParts(ship) {
  // (the body is scaled to the ship's radius already: the parts in its units)
  const holder = ship.model.body || ship.model.root;
  const r = ship.radius / (holder.scale.x || 1);
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x9aa4b4, metalness: 0.75, roughness: 0.32 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.6, roughness: 0.45 });
  const glow = new THREE.MeshBasicMaterial({ color: RING_IDLE.clone(), toneMapped: false });
  const tips = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 2.2), toneMapped: false });
  // the ring round the rim, and its housing
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.12, r * 0.05, 10, 64), glow);
  ring.rotation.x = Math.PI / 2;
  const housing = new THREE.Mesh(new THREE.TorusGeometry(r * 1.12, r * 0.085, 8, 48), dark);
  housing.rotation.x = Math.PI / 2;
  housing.scale.set(1, 1, 0.55);
  g.add(housing, ring);
  // two nacelles on swept struts, glowing at the front
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3, r * 0.06, r * 0.3), dark);
    strut.position.set(s * r * 1.12, -r * 0.08, r * 0.35);
    const nac = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.13, r * 1.15, 4, 12), hull);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(s * r * 1.3, -r * 0.08, r * 0.45);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 12, 8), tips);
    tip.position.set(s * r * 1.3, -r * 0.08, -r * 0.22);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(r * 0.04, r * 0.06, r * 1.0), glow);
    stripe.position.set(s * r * 1.3 + s * r * 0.12, -r * 0.08, r * 0.45);
    g.add(strut, nac, tip, stripe);
  }
  // blue running lights round the top
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(r * 0.045, 8, 6), tips);
    l.position.set(Math.cos(a) * r * 0.75, r * 0.12, Math.sin(a) * r * 0.75);
    g.add(l);
  }
  holder.add(g);
  return { group: g, ring, glow, tips, mats: [hull, dark, glow, tips], spin: 0 };
}

// The drive's sound: a deep hum, and filtered noise that rises with the warp.
class WarpSound {
  constructor(audio) {
    this.audio = audio;
    this.on = false;
  }
  start() {
    const a = this.audio;
    const ctx = a?.ctx;
    if (!ctx || !a._noise || this.on) return;
    const out = a.buses?.weapons || a.master;
    const t = ctx.currentTime;
    this.noise = a._noise(t, 900);
    this.bp = ctx.createBiquadFilter();
    this.bp.type = "bandpass";
    this.bp.frequency.value = 180;
    this.bp.Q.value = 1.4;
    this.g = ctx.createGain();
    this.g.gain.value = 0;
    this.noise.connect(this.bp).connect(this.g).connect(out);
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 38;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 220;
    this.og = ctx.createGain();
    this.og.gain.value = 0;
    this.osc.connect(this.lp).connect(this.og).connect(out);
    this.osc.start(t);
    // (the engage: a rising sweep)
    this.g.gain.setValueAtTime(0, t);
    this.g.gain.linearRampToValueAtTime(0.5, t + 0.35);
    this.bp.frequency.setValueAtTime(120, t);
    this.bp.frequency.exponentialRampToValueAtTime(2200, t + 0.9);
    this.og.gain.linearRampToValueAtTime(0.22, t + 0.6);
    this.on = true;
  }
  // k: 0-1 how deep into warp
  set(k) {
    if (!this.on) return;
    const t = this.audio.ctx.currentTime;
    this.g.gain.setTargetAtTime(0.12 + 0.28 * k, t, 0.2);
    this.bp.frequency.setTargetAtTime(300 + 1400 * k, t, 0.3);
    this.osc.frequency.setTargetAtTime(32 + 30 * k, t, 0.3);
  }
  stop() {
    if (!this.on) return;
    this.on = false;
    const ctx = this.audio.ctx;
    const t = ctx.currentTime;
    const { noise, osc, g, og, bp } = this;
    try {
      bp.frequency.cancelScheduledValues(t);
      bp.frequency.setValueAtTime(bp.frequency.value, t);
      bp.frequency.exponentialRampToValueAtTime(90, t + 0.6);
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.7);
      og.gain.cancelScheduledValues(t);
      og.gain.setValueAtTime(og.gain.value, t);
      og.gain.linearRampToValueAtTime(0, t + 0.5);
      noise.stop(t + 0.8);
      osc.stop(t + 0.8);
    } catch {
      // (already stopped)
    }
  }
}

// (Round 16 follow-up) Every UFO has the warp drive now, not one special
// ship: the sound and the stars' streaks come with any of them. Only a ship
// saved as a Warp Saucer before keeps its ring and nacelles.
UFO_HOOKS.created = (ship, data) => {
  ship.warp = true;
  if (data?.warp) {
    ship.legacyWarp = true;
    ship.name = "Warp Saucer";
    ship.facingOffset = 0;
    try {
      ship.warpParts = addParts(ship);
    } catch (err) {
      console.warn("MINECLAUDE: the Warp Saucer's drive wasn't drawn", err);
    }
  }
  const sound = new WarpSound(ship.manager.audio);
  // (js/solar.js: the look of the drive, k 0-1 into warp; its sound on / off)
  ship.warpFx = (dt, k, on) => {
    sound.set(k);
    const P = ship.warpParts;
    if (!P) return;
    P.spin += dt * (0.6 + 9 * k);
    P.ring.rotation.z = P.spin;
    P.glow.color.copy(RING_IDLE).lerp(RING_WARP, k);
  };
  ship.warpSound = (on) => (on ? sound.start() : sound.stop());
  const dispose = ship.dispose.bind(ship);
  ship.dispose = () => {
    sound.stop();
    for (const m of ship.warpParts?.mats || []) m.dispose();
    dispose();
  };
};

UFO_HOOKS.saved = (ship, data) => {
  if (ship.legacyWarp) data.warp = true;
};

UFO_HOOKS.update = (ship, dt, input) => {
  if (!ship.warp) return;
  ship.warpFx?.(dt, 0, false);
  if (input?.pressed?.has("KeyJ")) ship.manager.onMessage?.("The warp drive works in space: climb past the space line (6,000 m over Earth) first");
};

// Creative's Warp Saucer: the call-in (straight into the air, at the
// controls) and the Vehicles tab's item.
VehicleManager.registerSummon("warp", {
  type: "ufo",
  alt: 40,
  // (Round 16 follow-up: an ordinary UFO now; every UFO has the drive)
  data: () => ({ design: "saucer_domed", seed: Math.floor(Math.random() * 1e6), radius: 6, glow: true }),
});
