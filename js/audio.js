// Procedural Web Audio sound effects, no audio files.
//
// Almost everything is shaped noise: short filtered bursts with natural
// envelopes (fast attack, exponential decay), resonant band-pass filters for
// "material" (a woody knock, a glassy chink), and several layered hits for
// grains and debris. The only pitched sounds are creature voices, which run a
// buzzy source through vowel-like formant filters with a little vibrato, the
// way a throat shapes sound, rather than bare oscillator sweeps.
//
// Everything routes through a master gain and a dynamics compressor, so loud
// layered sounds (explosions) can peak hard without clipping.

import { explosionSound } from "./falloff.js";

const NOISE_SECONDS = 2.5;

// Block material sounds: layers of filtered noise.
//   f: filter frequency, q: resonance, type: filter type, d: duration (s),
//   v: volume, n: number of staggered grains, spread: seconds between grains.
const MATERIALS = {
  stone: [
    { type: "bandpass", f: 1700, q: 1.1, d: 0.08, v: 1 },
    { type: "lowpass", f: 420, q: 0.7, d: 0.1, v: 0.7 },
  ],
  wood: [
    { type: "bandpass", f: 320, q: 4, d: 0.14, v: 1.2 },
    { type: "bandpass", f: 1100, q: 1.2, d: 0.05, v: 0.5 },
  ],
  grass: [{ type: "bandpass", f: 2800, q: 0.8, d: 0.07, v: 0.7, n: 3, spread: 0.035 }],
  plant: [{ type: "bandpass", f: 3400, q: 0.9, d: 0.05, v: 0.5, n: 2, spread: 0.03 }],
  dirt: [{ type: "lowpass", f: 500, q: 0.8, d: 0.11, v: 1.1, n: 2, spread: 0.025 }],
  sand: [{ type: "bandpass", f: 3200, q: 0.6, d: 0.05, v: 0.6, n: 4, spread: 0.028 }],
  glass: [
    { type: "highpass", f: 2500, q: 0.7, d: 0.05, v: 0.5 },
    { type: "bandpass", f: 4200, q: 14, d: 0.12, v: 1.4, n: 4, spread: 0.03, jitter: 0.5 },
  ],
  cloth: [{ type: "lowpass", f: 380, q: 0.7, d: 0.12, v: 0.9 }],
};

// Creature voices. Each call: f0 -> f1 pitch glide, formants [freq, q, gain]
// (vowel shape), vib: vibrato depth (fraction), breath: noise mixed in.
const VOICES = {
  alien: {
    // Warbling, high chatter.
    idle: [
      { f0: 620, f1: 900, d: 0.16, v: 0.16, formants: [[1400, 7, 1], [2600, 8, 0.5]], vib: 0.12, breath: 0.1 },
      { f0: 880, f1: 540, d: 0.2, v: 0.14, formants: [[1500, 7, 1]], vib: 0.15, breath: 0.1, delay: 0.18 },
    ],
    hurt: [{ f0: 1200, f1: 700, d: 0.18, v: 0.2, formants: [[1700, 5, 1], [3000, 6, 0.4]], vib: 0.1, breath: 0.2 }],
    death: [{ f0: 900, f1: 180, d: 0.7, v: 0.2, formants: [[1300, 5, 1], [2400, 6, 0.4]], vib: 0.18, breath: 0.2 }],
  },
  fluffalo: {
    // A low, nasal grumble.
    idle: [{ f0: 92, f1: 78, d: 0.9, v: 0.32, formants: [[260, 5, 1.2], [620, 6, 0.5]], vib: 0.02, breath: 0.2 }],
    hurt: [{ f0: 150, f1: 110, d: 0.3, v: 0.36, formants: [[320, 5, 1], [760, 5, 0.5]], vib: 0.03, breath: 0.3 }],
    death: [{ f0: 130, f1: 60, d: 0.9, v: 0.34, formants: [[280, 5, 1], [640, 6, 0.4]], vib: 0.03, breath: 0.3 }],
  },
  hoplet: {
    // Tiny squeaks: short, breathy whistles.
    idle: [
      { f0: 1500, f1: 1800, d: 0.06, v: 0.1, formants: [[1700, 8, 1]], breath: 0.5 },
      { f0: 1600, f1: 1950, d: 0.05, v: 0.08, formants: [[1800, 8, 1]], breath: 0.5, delay: 0.1 },
    ],
    hurt: [{ f0: 2100, f1: 1400, d: 0.13, v: 0.16, formants: [[1900, 6, 1]], breath: 0.5 }],
    death: [{ f0: 1700, f1: 700, d: 0.3, v: 0.16, formants: [[1500, 5, 1]], breath: 0.5 }],
  },
  mossback: {
    // Clicks and a slow hiss.
    idle: [{ noise: { type: "bandpass", f: 900, q: 3, d: 0.04, v: 0.35, n: 2, spread: 0.09 } }],
    hurt: [{ noise: { type: "bandpass", f: 2600, q: 0.8, d: 0.35, v: 0.3, attack: 0.05 } }],
    death: [{ noise: { type: "bandpass", f: 2200, q: 0.8, d: 0.7, v: 0.3, attack: 0.08 } }],
  },
  zombie: {
    // A hollow, breathy moan ("uhh") with a slow waver.
    idle: [{ f0: 105, f1: 82, d: 1.2, v: 0.38, formants: [[480, 6, 1], [900, 7, 0.6], [2400, 9, 0.15]], vib: 0.035, breath: 0.35 }],
    hurt: [{ f0: 160, f1: 115, d: 0.28, v: 0.38, formants: [[560, 5, 1], [1000, 6, 0.5]], vib: 0.02, breath: 0.4 }],
    death: [{ f0: 130, f1: 48, d: 1.3, v: 0.4, formants: [[440, 5, 1], [820, 6, 0.5]], vib: 0.05, breath: 0.4 }],
    attack: [{ f0: 190, f1: 140, d: 0.22, v: 0.36, formants: [[620, 4, 1], [1150, 5, 0.6]], vib: 0.02, breath: 0.5 }],
  },
  skeleton: {
    // A dry, rattling clatter of bone on bone.
    idle: [{ noise: { type: "bandpass", f: 2800, q: 4, d: 0.06, v: 0.22, n: 3, spread: 0.05, jitter: 0.4 } }],
    hurt: [{ noise: { type: "bandpass", f: 3200, q: 3, d: 0.1, v: 0.3, n: 2, spread: 0.04 } }],
    death: [{ noise: { type: "bandpass", f: 2000, q: 2, d: 0.5, v: 0.3, n: 4, spread: 0.08 } }],
  },
  spider: {
    // A wet, chittering hiss.
    idle: [{ noise: { type: "bandpass", f: 4200, q: 5, d: 0.08, v: 0.16, n: 3, spread: 0.06, jitter: 0.5 } }],
    hurt: [{ noise: { type: "bandpass", f: 3600, q: 3, d: 0.12, v: 0.24 } }],
    death: [{ noise: { type: "bandpass", f: 2600, q: 2, d: 0.4, v: 0.26 } }],
  },
  cow: {
    idle: [{ f0: 110, f1: 150, d: 0.7, v: 0.3, formants: [[300, 5, 1], [700, 6, 0.5]], vib: 0.04, breath: 0.15 }],
    hurt: [{ f0: 180, f1: 130, d: 0.25, v: 0.32, formants: [[340, 5, 1]], breath: 0.25 }],
    death: [{ f0: 140, f1: 50, d: 0.8, v: 0.32, formants: [[300, 5, 1]], breath: 0.3 }],
  },
  pig: {
    idle: [{ f0: 320, f1: 260, d: 0.25, v: 0.22, formants: [[600, 6, 1]], breath: 0.35 }],
    hurt: [{ f0: 420, f1: 300, d: 0.18, v: 0.26, formants: [[700, 6, 1]], breath: 0.4 }],
    death: [{ f0: 350, f1: 150, d: 0.4, v: 0.26, formants: [[600, 5, 1]], breath: 0.4 }],
  },
  chicken: {
    idle: [{ noise: { type: "bandpass", f: 1800, q: 5, d: 0.05, v: 0.16, n: 2, spread: 0.06, jitter: 0.5 } }],
    hurt: [{ noise: { type: "bandpass", f: 2200, q: 4, d: 0.08, v: 0.2 } }],
    death: [{ noise: { type: "bandpass", f: 1600, q: 3, d: 0.2, v: 0.2 } }],
  },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._noiseBuffer = null;
    this._shaperCurve = null;
    // Per-category volume (0-1), set from the settings menu. Each category
    // has its own gain node feeding the master gain.
    this.volumes = { master: 1, blocks: 1, weapons: 1, creatures: 1, player: 1, ui: 1 };
    this.buses = {};
    this._out = null; // the bus of the sound being played
  }

  setVolume(category, value) {
    const v = Math.max(0, Math.min(1, Number(value)));
    if (!Number.isFinite(v)) return;
    this.volumes[category] = v;
    if (!this.ctx) return;
    if (category === "master") this.master.gain.value = 0.9 * v;
    else if (this.buses[category]) this.buses[category].gain.value = v;
  }

  // Routes the following sounds into a category's bus.
  _cat(name) {
    this._out = this.buses[name] || this.master;
  }

  ensureStarted() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 8;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      compressor.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9 * this.volumes.master;
      this.master.connect(compressor);
      for (const name of ["blocks", "weapons", "creatures", "player", "ui"]) {
        const bus = this.ctx.createGain();
        bus.gain.value = this.volumes[name];
        bus.connect(this.master);
        this.buses[name] = bus;
      }
      this._out = this.master;
      this._noiseBuffer = this._makeNoiseBuffer();
      this._shaperCurve = this._makeShaperCurve(2.5);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  _makeNoiseBuffer() {
    const length = Math.floor(this.ctx.sampleRate * NOISE_SECONDS);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // Soft-clipping curve (tanh) used to add grit to the explosion body.
  _makeShaperCurve(drive) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    return curve;
  }

  // A noise source starting at a random offset in the shared buffer (so
  // repeated sounds don't sound identical), playing for `duration` seconds.
  _noise(when, duration) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    if (duration > NOISE_SECONDS - 0.1) src.loop = true; // long sounds (engines, meteors)
    const maxOffset = Math.max(0, NOISE_SECONDS - duration - 0.05);
    src.start(when, Math.random() * maxOffset, duration + 0.05);
    return src;
  }

  // One filtered noise hit (or `n` staggered grains of it) into `dest`.
  _hit({ type = "lowpass", f = 1000, q = 1, d = 0.1, v = 0.3, n = 1, spread = 0.03, jitter = 0.15, attack = 0.004, fEnd = null }, when = 0, dest = null) {
    if (!this.ctx) return;
    const out = dest || this._out || this.master;
    for (let i = 0; i < n; i++) {
      const t = this.ctx.currentTime + when + i * spread * (0.7 + Math.random() * 0.6);
      const src = this._noise(t, d + attack);
      const filter = this.ctx.createBiquadFilter();
      filter.type = type;
      const freq = f * (1 + (Math.random() - 0.5) * 2 * jitter);
      filter.frequency.setValueAtTime(freq, t);
      if (fEnd) filter.frequency.exponentialRampToValueAtTime(fEnd, t + d);
      filter.Q.value = q;
      const g = this.ctx.createGain();
      const peak = v * (n > 1 ? 0.75 + Math.random() * 0.5 : 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + d);
      src.connect(filter).connect(g).connect(out);
    }
  }

  // A creature voice: a buzzy source through formant filters.
  _voice({ f0, f1, d, v, formants, vib = 0, breath = 0, delay = 0 }, gainScale = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(v * gainScale, t + Math.min(0.06, d * 0.3));
    bus.gain.setValueAtTime(v * gainScale, t + d * 0.55);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + d);
    bus.connect(this._out || this.master);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const jitter = 0.94 + Math.random() * 0.12;
    osc.frequency.setValueAtTime(f0 * jitter, t);
    osc.frequency.exponentialRampToValueAtTime(f1 * jitter, t + d);
    if (vib > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5 + Math.random() * 2;
      const depth = ctx.createGain();
      depth.gain.value = f0 * vib;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + d + 0.05);
    }
    // Soften the raw buzz, then shape it with the formants.
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = Math.max(formants[formants.length - 1][0] * 1.6, 800);
    osc.connect(soften);
    for (const [ff, q, g] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = ff;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = g * 2.2;
      soften.connect(bp).connect(fg).connect(bus);
    }
    osc.start(t);
    osc.stop(t + d + 0.05);
    if (breath > 0) {
      // Breath: noise through the main formant.
      const src = this._noise(t, d);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = formants[0][0] * 1.4;
      bp.Q.value = 1.2;
      const bg = ctx.createGain();
      bg.gain.value = breath;
      src.connect(bp).connect(bg).connect(bus);
    }
  }

  // Break/place/dig/step sounds per block material.
  _material(sound, { volume = 0.25, duration = 1, pitch = 1 } = {}) {
    const layers = MATERIALS[sound] || MATERIALS.stone;
    for (const layer of layers) {
      this._hit({ ...layer, f: layer.f * pitch, d: layer.d * duration, v: layer.v * volume });
    }
  }

  playBreak(sound = "stone") {
    this._cat("blocks");
    this._material(sound, { volume: 0.34, duration: 1.5, pitch: 0.95 });
    // Crumbs settling after the break.
    this._hit({ type: "bandpass", f: 1800, q: 1, d: 0.03, v: 0.06, n: 3, spread: 0.05 }, 0.08);
  }

  playPlace(sound = "stone") {
    this._cat("blocks");
    this._material(sound, { volume: 0.26, duration: 0.8, pitch: 1.1 });
  }

  playDig(sound = "stone") {
    this._cat("blocks");
    this._material(sound, { volume: 0.15, duration: 0.6, pitch: 1.05 });
  }

  playFootstep(sound = "grass") {
    this._cat("blocks");
    this._material(sound, { volume: 0.1, duration: 0.6, pitch: 0.8 });
  }

  // Picking up an item: a soft little pop.
  playPickup() {
    this._cat("ui");
    this._hit({ type: "bandpass", f: 1400, q: 3, d: 0.035, v: 0.16, jitter: 0.2 });
  }

  // UI click: a quiet tick.
  playClick() {
    this._cat("ui");
    this._hit({ type: "bandpass", f: 3200, q: 1.5, d: 0.015, v: 0.08, jitter: 0.1 });
  }

  // Crafting: two quick woody taps.
  playCraft() {
    this._cat("ui");
    this._hit({ type: "bandpass", f: 700, q: 3, d: 0.05, v: 0.22, n: 2, spread: 0.08 });
  }

  // A crunchy bite.
  playEat() {
    this._cat("ui");
    this._hit({ type: "bandpass", f: 1400, q: 1.2, d: 0.05, v: 0.14, n: 3, spread: 0.022, jitter: 0.4 });
  }

  // A tool breaking: a sharp snap and a few small bits.
  playToolBreak() {
    this._cat("player");
    this._hit({ type: "highpass", f: 2200, q: 0.8, d: 0.06, v: 0.3 });
    this._hit({ type: "bandpass", f: 900, q: 2, d: 0.05, v: 0.2, n: 3, spread: 0.04 }, 0.04);
  }

  // Getting hurt: a dull body thud.
  playHurt() {
    this._cat("player");
    this._hit({ type: "lowpass", f: 320, q: 1.2, d: 0.14, v: 0.55, fEnd: 120 });
    this._hit({ type: "bandpass", f: 900, q: 1, d: 0.05, v: 0.1 });
  }

  // Dying: a heavier thud as the body hits the ground, and a low rumble.
  playDeath() {
    this._cat("player");
    this._hit({ type: "lowpass", f: 380, q: 1.2, d: 0.25, v: 0.7, fEnd: 90 });
    this._hit({ type: "lowpass", f: 180, q: 0.8, d: 0.8, v: 0.35, attack: 0.05 }, 0.12);
  }

  playSplash() {
    this._cat("player");
    this._hit({ type: "lowpass", f: 1400, q: 0.7, d: 0.4, v: 0.3, fEnd: 400, attack: 0.01 });
    this._hit({ type: "bandpass", f: 2600, q: 1.5, d: 0.04, v: 0.08, n: 5, spread: 0.06, jitter: 0.4 }, 0.1); // droplets
  }

  // Flight on/off (creative): a short soft rush of air.
  playFlightToggle(enabled) {
    this._cat("player");
    this._hit({ type: "bandpass", f: enabled ? 700 : 1200, fEnd: enabled ? 1400 : 600, q: 1.2, d: 0.22, v: 0.1, attack: 0.05 });
  }

  // Throwing: an airy whoosh.
  playThrow() {
    this._cat("weapons");
    this._hit({ type: "bandpass", f: 700, fEnd: 1600, q: 1.4, d: 0.2, v: 0.16, attack: 0.03 });
  }

  // Pistol shot: a sharp crack, a punchy body, a low thump and a short tail.
  playGunshot() {
    this._cat("weapons");
    this._hit({ type: "highpass", f: 2600, q: 0.7, d: 0.03, v: 0.55, attack: 0.001 });
    this._hit({ type: "bandpass", f: 950, q: 1, d: 0.08, v: 0.6, attack: 0.001 });
    this._hit({ type: "lowpass", f: 200, q: 1, d: 0.12, v: 0.55, attack: 0.002 });
    this._hit({ type: "lowpass", f: 1400, fEnd: 300, q: 0.7, d: 0.35, v: 0.12, attack: 0.01 }, 0.02);
  }

  // Machine gun: a lighter, quicker crack for rapid automatic fire.
  playMachineGun() {
    this._cat("weapons");
    this._hit({ type: "highpass", f: 2400, q: 0.7, d: 0.02, v: 0.4, attack: 0.001 });
    this._hit({ type: "bandpass", f: 1100, q: 1, d: 0.05, v: 0.42, attack: 0.001 });
    this._hit({ type: "lowpass", f: 220, q: 1, d: 0.07, v: 0.32, attack: 0.001 });
  }

  // Sniper rifle: a deep, sharp crack with a long, rolling tail.
  playSniperShot() {
    this._cat("weapons");
    this._hit({ type: "highpass", f: 3200, q: 0.6, d: 0.04, v: 0.7, attack: 0.001 });
    this._hit({ type: "bandpass", f: 700, q: 0.9, d: 0.16, v: 0.62, attack: 0.001 });
    this._hit({ type: "lowpass", f: 130, q: 1, d: 0.4, v: 0.5, attack: 0.002 });
    this._hit({ type: "lowpass", f: 1200, fEnd: 250, q: 0.6, d: 0.6, v: 0.14, attack: 0.02 }, 0.03);
  }

  // Airstrike designator: a rising electronic lock-on beep.
  playLockOn() {
    this._cat("weapons");
    this._hit({ type: "bandpass", f: 900, fEnd: 1800, q: 3, d: 0.15, v: 0.25, attack: 0.005 });
  }

  // A bullet hitting a block `distance` blocks away: a small sharp tick.
  playRicochet(distance = 0) {
    this._cat("weapons");
    this._hit({ type: "bandpass", f: 2900, q: 7, d: 0.05, v: 0.14 / (1 + distance / 10), jitter: 0.3 }, Math.min(distance / 343, 0.5));
  }

  // Bazooka launch: a heavy thump and a rising rush of burning propellant.
  playRocketLaunch() {
    this._cat("weapons");
    this._hit({ type: "lowpass", f: 160, q: 1, d: 0.25, v: 0.7, attack: 0.002 });
    this._hit({ type: "bandpass", f: 400, fEnd: 1500, q: 1.1, d: 0.5, v: 0.4, attack: 0.01 });
    this._hit({ type: "highpass", f: 3000, q: 0.7, d: 0.4, v: 0.14, attack: 0.02 });
  }

  // A sci-fi blaster "pew": a bright tone that dives in pitch, with a
  // ringing overtone and a short electric crackle. Enemy lasers (UFOs,
  // aliens) are lower and buzzier. Quieter and later with distance.
  playBlaster(distance = 0, owner = "player") {
    this._cat("weapons");
    const ctx = this.ctx;
    if (!ctx || distance > 180) return;
    const enemy = owner !== "player" && owner !== "playerufo";
    const gain = 0.34 / (1 + distance / 14);
    if (gain < 0.004) return;
    const t = ctx.currentTime + Math.min(distance / 343, 0.4);
    const f0 = (enemy ? 1300 : 2300) * (0.93 + Math.random() * 0.14);
    const f1 = enemy ? 110 : 190;
    const d = enemy ? 0.26 : 0.19;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(700, 9000 / (1 + distance / 30));
    out.connect(lp).connect(this._out || this.master);
    for (const [type, mul, g] of [[enemy ? "sawtooth" : "square", 1, 0.55], ["sine", 1.51, 0.45]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0 * mul, t);
      osc.frequency.exponentialRampToValueAtTime(f1 * mul, t + d);
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og).connect(out);
      osc.start(t);
      osc.stop(t + d + 0.02);
    }
    this._hit({ type: "highpass", f: 4000, q: 0.7, d: 0.025, v: gain * 0.6, attack: 0.001 }, t - ctx.currentTime);
  }

  // A laser bolt hitting a block: a sizzling crackle.
  playLaserHit(distance = 0) {
    this._cat("weapons");
    const v = 0.16 / (1 + distance / 10);
    if (v < 0.004) return;
    this._hit({ type: "bandpass", f: 3200, fEnd: 900, q: 1.4, d: 0.12, v, n: 2, spread: 0.03, jitter: 0.3 }, Math.min(distance / 343, 0.4));
  }

  // A meteor screaming in: a rising roar and a falling whistle over its
  // whole flight (`duration` s), from `distance` blocks away at the start.
  playMeteorIncoming(duration = 3, distance = 150) {
    this._cat("weapons");
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const d = Math.max(0.5, Math.min(8, duration));
    const peak = 0.16 / (1 + Math.max(0, distance - 150) / 120);
    const roar = this._noise(t, d);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak * 0.3, t + d * 0.4);
    g.gain.exponentialRampToValueAtTime(peak, t + d * 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
    roar.connect(bp).connect(g).connect(this._out || this.master);
    const rumble = this._noise(t, d);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(peak * 2.2, t + d * 0.95);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
    rumble.connect(lp).connect(rg).connect(this._out || this.master);
  }

  // ---------- UFOs and vehicles ----------

  // A continuous, wobbling UFO hum for the nearest UFO (volume 0-1), with a
  // shimmering tone on top while a tractor beam holds the player (beam 0-1).
  setUfoHum(volume, beam = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this._hum) {
      if (volume <= 0.001 && beam <= 0) return;
      const out = ctx.createGain();
      out.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      out.connect(this.buses.creatures || this.master);
      lp.connect(out);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 9;
      lfo.connect(lfoGain);
      for (const [f, type, g] of [[62, "sine", 0.6], [93.5, "triangle", 0.35], [187, "sine", 0.12]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        lfoGain.connect(o.frequency);
        const og = ctx.createGain();
        og.gain.value = g;
        o.connect(og).connect(lp);
        o.start();
      }
      lfo.start();
      // The beam's shimmer.
      const beamGain = ctx.createGain();
      beamGain.gain.value = 0;
      const shimmer = ctx.createOscillator();
      shimmer.type = "sine";
      shimmer.frequency.value = 740;
      const vib = ctx.createOscillator();
      vib.frequency.value = 11;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 60;
      vib.connect(vibGain).connect(shimmer.frequency);
      const sweep = ctx.createOscillator();
      sweep.frequency.value = 0.5;
      const sweepGain = ctx.createGain();
      sweepGain.gain.value = 180;
      sweep.connect(sweepGain).connect(shimmer.frequency);
      shimmer.connect(beamGain).connect(this.buses.creatures || this.master);
      shimmer.start();
      vib.start();
      sweep.start();
      this._hum = { out, beamGain };
    }
    const t = ctx.currentTime;
    this._hum.out.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 0.32, t, 0.15);
    this._hum.beamGain.gain.setTargetAtTime(beam > 0 ? 0.05 : 0, t, 0.2);
  }

  // A UFO shooting off into the sky: a rising whoosh and zap.
  playUfoLeave(distance = 0) {
    this._cat("creatures");
    if (!this.ctx) return;
    const v = 0.35 / (1 + distance / 60);
    if (v < 0.01) return;
    this._hit({ type: "bandpass", f: 300, fEnd: 4000, q: 2, d: 0.9, v, attack: 0.05 });
    this._voice({ f0: 200, f1: 2400, d: 0.8, v: v * 0.6, formants: [[1200, 3, 1]], vib: 0.05 });
  }

  // A hit on a UFO's hull (a metallic crunch; heavier when it goes down).
  playUfoHit(distance = 0, big = false) {
    this._cat("weapons");
    const v = (big ? 0.5 : 0.22) / (1 + distance / 40);
    if (v < 0.01) return;
    this._hit({ type: "bandpass", f: big ? 700 : 1800, q: 5, d: big ? 0.5 : 0.12, v, n: big ? 3 : 1, spread: 0.08, jitter: 0.3 });
    if (big) this._hit({ type: "lowpass", f: 200, q: 1, d: 0.8, v: v * 1.4, attack: 0.01 });
  }

  playVehicleEnter(type) {
    this._cat("player");
    this._hit({ type: "bandpass", f: type === "ufo" ? 600 : 300, fEnd: type === "ufo" ? 1600 : 900, q: 3, d: 0.3, v: 0.2, attack: 0.02 });
    this._hit({ type: "lowpass", f: 300, q: 1, d: 0.1, v: 0.25 });
  }

  playVehicleExit(type) {
    this._cat("player");
    this._hit({ type: "bandpass", f: type === "ufo" ? 1600 : 900, fEnd: type === "ufo" ? 500 : 250, q: 3, d: 0.25, v: 0.16, attack: 0.02 });
  }

  // Ejection seat: a bang and a rocket hiss.
  playEject() {
    this._cat("player");
    this._hit({ type: "lowpass", f: 400, q: 1, d: 0.2, v: 0.8, attack: 0.002 });
    this._hit({ type: "highpass", f: 1500, q: 0.7, d: 0.9, v: 0.3, attack: 0.02 });
  }

  // A parachute snapping open.
  playParachute() {
    this._cat("player");
    this._hit({ type: "bandpass", f: 500, q: 1.2, d: 0.35, v: 0.45, attack: 0.01, fEnd: 200 });
    this._hit({ type: "highpass", f: 2500, q: 0.7, d: 0.15, v: 0.15 });
  }

  // ---------- Jet ----------

  // The jet engine: a continuous turbine whine plus a roar that grows with
  // the throttle; the afterburner adds a deep rumble. active = false fades
  // it out (out of the jet).
  setJetEngine(throttle, afterburner, speed, active) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this._jet) {
      if (!active) return;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(this.buses.weapons || this.master);
      // Roar: filtered noise (looped for as long as the engine runs).
      const loopNoise = () => {
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuffer;
        src.loop = true;
        src.start();
        return src;
      };
      const roar = loopNoise();
      const roarF = ctx.createBiquadFilter();
      roarF.type = "lowpass";
      roarF.frequency.value = 600;
      const roarG = ctx.createGain();
      roar.connect(roarF).connect(roarG).connect(out);
      // Turbine whine.
      const whine = ctx.createOscillator();
      whine.type = "sawtooth";
      whine.frequency.value = 800;
      const whineF = ctx.createBiquadFilter();
      whineF.type = "bandpass";
      whineF.frequency.value = 2400;
      whineF.Q.value = 6;
      const whineG = ctx.createGain();
      whineG.gain.value = 0.05;
      whine.connect(whineF).connect(whineG).connect(out);
      whine.start();
      // Afterburner rumble.
      const ab = loopNoise();
      const abF = ctx.createBiquadFilter();
      abF.type = "lowpass";
      abF.frequency.value = 160;
      const abG = ctx.createGain();
      abG.gain.value = 0;
      ab.connect(abF).connect(abG).connect(out);
      this._jet = { out, roarF, roarG, whine, whineF, abG };
    }
    const j = this._jet;
    const t = ctx.currentTime;
    j.out.gain.setTargetAtTime(active ? 0.55 : 0, t, active ? 0.2 : 0.4);
    j.roarF.frequency.setTargetAtTime(350 + throttle * 1400 + speed * 3, t, 0.2);
    j.roarG.gain.setTargetAtTime(0.25 + throttle * 0.6, t, 0.2);
    j.whine.frequency.setTargetAtTime(600 + throttle * 900, t, 0.3);
    j.whineF.frequency.setTargetAtTime(1800 + throttle * 1800, t, 0.3);
    j.abG.gain.setTargetAtTime(afterburner ? 1.4 : 0, t, 0.15);
  }

  // One autocannon round (a very short, low crack; they come 16 a second).
  playCannon() {
    this._cat("weapons");
    this._hit({ type: "lowpass", f: 900, q: 0.8, d: 0.045, v: 0.22, attack: 0.001 });
    this._hit({ type: "highpass", f: 2600, q: 0.7, d: 0.02, v: 0.08, attack: 0.001 });
  }

  // Missile lock: a short beep while locking, a high tone once locked.
  playLockTone(locked) {
    this._cat("weapons");
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = locked ? 1750 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    g.gain.setValueAtTime(0.05, t + (locked ? 0.07 : 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (locked ? 0.085 : 0.07));
    o.connect(g).connect(this._out || this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  // A warning beep-beep (nuke away, incoming).
  playWarning() {
    this._cat("ui");
    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < 2; i++) {
      const t = ctx.currentTime + i * 0.18;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = 880;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g).connect(this._out || this.master);
      o.start(t);
      o.stop(t + 0.15);
    }
  }

  // Wheels touching down.
  playLanding() {
    this._cat("weapons");
    this._hit({ type: "bandpass", f: 900, q: 1.5, d: 0.3, v: 0.25, n: 2, spread: 0.12 });
    this._hit({ type: "lowpass", f: 200, q: 1, d: 0.2, v: 0.4 });
  }

  // The nuke: an enormous, long, low boom that arrives late from far away
  // (and is still heard kilometres off).
  playNuke(distance = 0, radius = 28) {
    this._cat("weapons");
    const ctx = this.ctx;
    if (!ctx) return;
    const delay = Math.min(distance / 343, 6);
    const gain = 1.6 / (1 + distance / 400);
    const muffle = Math.max(140, 12000 * Math.exp(-distance / 500));
    const t0 = ctx.currentTime + delay;
    const out = ctx.createGain();
    out.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = muffle;
    lp.connect(out).connect(this._out || this.master);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(55, t0);
    sub.frequency.exponentialRampToValueAtTime(18, t0 + 5);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, t0);
    subG.gain.exponentialRampToValueAtTime(1.2, t0 + 0.05);
    subG.gain.exponentialRampToValueAtTime(0.0001, t0 + 7);
    sub.connect(subG).connect(lp);
    sub.start(t0);
    sub.stop(t0 + 7.2);
    const body = this._noise(t0, 9);
    const bodyF = ctx.createBiquadFilter();
    bodyF.type = "lowpass";
    bodyF.frequency.setValueAtTime(2500, t0);
    bodyF.frequency.exponentialRampToValueAtTime(90, t0 + 8);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._shaperCurve;
    const bodyG = ctx.createGain();
    bodyG.gain.setValueAtTime(0.0001, t0);
    bodyG.gain.exponentialRampToValueAtTime(1.6, t0 + 0.02);
    bodyG.gain.exponentialRampToValueAtTime(0.4, t0 + 2);
    bodyG.gain.exponentialRampToValueAtTime(0.0001, t0 + 9);
    body.connect(bodyF).connect(shaper).connect(bodyG).connect(lp);
  }

  // A pickup/notice chime (UFO down, abductions escaped).
  playNotice() {
    this._cat("ui");
    if (!this.ctx) return;
    this._voice({ f0: 880, f1: 1320, d: 0.25, v: 0.12, formants: [[1500, 2, 1]] });
  }

  // A grenade bouncing: a small metallic clink and a thud (strength 0-1).
  playGrenadeBounce(strength = 1, distance = 0) {
    this._cat("weapons");
    const v = strength / (1 + distance / 8);
    if (v < 0.02) return;
    this._hit({ type: "bandpass", f: 2400, q: 6, d: 0.035, v: 0.18 * v, jitter: 0.2 });
    this._hit({ type: "lowpass", f: 420, q: 1, d: 0.06, v: 0.22 * v });
  }

  // Mob voices: `event` is "idle", "hurt", "death" or "attack"; quieter
  // with distance (blocks), silent beyond 40.
  playMob(kind, event, distance = 0) {
    this._cat("creatures");
    if (!this.ctx || distance > 40) return;
    const gain = 1 / (1 + distance / 7);
    // Variants ("alien_gray") share their family's voice.
    const parts = (VOICES[kind] || VOICES[String(kind).split("_")[0]])?.[event];
    if (!parts) return;
    for (const part of parts) {
      if (part.noise) this._hit({ ...part.noise, v: part.noise.v * gain }, part.delay || 0);
      else this._voice(part, gain);
    }
  }

  // The player's weapon landing (a heavier crack on a critical hit).
  playHit(crit = false) {
    this._cat("weapons");
    this._hit({ type: "lowpass", f: 700, q: 1, d: 0.08, v: 0.35, fEnd: 200 });
    this._hit({ type: "bandpass", f: 1600, q: 1.2, d: 0.03, v: 0.12 });
    if (crit) this._hit({ type: "highpass", f: 3000, q: 0.8, d: 0.1, v: 0.2 });
  }

  // A swing that hits nothing.
  playSwing() {
    this._cat("weapons");
    this._hit({ type: "bandpass", f: 1100, fEnd: 700, q: 1.5, d: 0.12, v: 0.08, attack: 0.02 });
  }

  // Layered explosion: a sub-bass thump, a distorted low-passed noise body
  // with a falling cutoff, a sharp crack on top, a long rumble tail, and a
  // patter of falling debris. Distance (blocks) makes it quieter, more
  // muffled (a low-pass filter, like sound travelling through air) and a
  // little delayed; `size` (1 = grenade, 5 = bazooka) makes it bigger.
  playExplosion(distance = 0, size = 1) {
    this._cat("weapons");
    const ctx = this.ctx;
    if (!ctx) return;
    const p = explosionSound(distance, size);
    if (p.gain < 0.004) return;
    const t0 = ctx.currentTime + p.delay;
    const long = Math.sqrt(size); // bigger blasts ring out longer
    const muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = p.cutoff;
    muffle.Q.value = 0.5;
    const out = ctx.createGain();
    out.gain.value = p.gain;
    muffle.connect(out).connect(this._out || this.master);

    const env = (gainNode, attackEnd, peak, decayEnd) => {
      gainNode.gain.setValueAtTime(0.0001, t0);
      gainNode.gain.exponentialRampToValueAtTime(peak, attackEnd);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, decayEnd);
    };

    // Sub-bass thump (deeper for bigger blasts).
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(95 / Math.sqrt(long), t0);
    sub.frequency.exponentialRampToValueAtTime(26, t0 + 0.9 * long);
    const subGain = ctx.createGain();
    env(subGain, t0 + 0.012, 1.1, t0 + 1.4 * long);
    sub.connect(subGain).connect(muffle);
    sub.start(t0);
    sub.stop(t0 + 1.5 * long);

    // Distorted body with a falling low-pass cutoff.
    const body = this._noise(t0, Math.min(2.4, 2.0 * long));
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.Q.value = 0.8;
    bodyFilter.frequency.setValueAtTime(3200, t0);
    bodyFilter.frequency.exponentialRampToValueAtTime(140, t0 + 1.4 * long);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._shaperCurve;
    const bodyGain = ctx.createGain();
    env(bodyGain, t0 + 0.008, 1.5, t0 + Math.min(2.4, 1.9 * long));
    body.connect(bodyFilter).connect(shaper).connect(bodyGain).connect(muffle);

    // Sharp crack transient.
    const crack = this._noise(t0, 0.12);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 1800;
    const crackGain = ctx.createGain();
    env(crackGain, t0 + 0.003, 0.9, t0 + 0.1);
    crack.connect(crackFilter).connect(crackGain).connect(muffle);

    // Long low rumble tail (several seconds for the bazooka).
    const rumbleLen = Math.min(NOISE_SECONDS - 0.1, 2.4 * long);
    const rumble = this._noise(t0, rumbleLen);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 140;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, t0);
    rumbleGain.gain.exponentialRampToValueAtTime(0.9 * Math.min(long, 1.6), t0 + 0.15);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, t0 + rumbleLen);
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(muffle);

    // Debris patter: a handful of tiny ticks as chunks rain back down.
    const ticks = Math.round(9 * long);
    for (let i = 0; i < ticks; i++) {
      const when = t0 + 0.35 + Math.random() * 1.3 * long;
      const tick = this._noise(when, 0.05);
      const tickFilter = ctx.createBiquadFilter();
      tickFilter.type = "bandpass";
      tickFilter.frequency.value = 700 + Math.random() * 2200;
      const tickGain = ctx.createGain();
      tickGain.gain.setValueAtTime(0.05 + Math.random() * 0.12, when);
      tickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      tick.connect(tickFilter).connect(tickGain).connect(muffle);
    }
  }
}
