// (Round 21) The colossi's sounds (WebAudio, no files), on js/audio.js's
// context and its creatures' bus: a low drone that swells as one comes near
// (two detuned saws under a slow throb, a thin ghostly whine on top), the
// footfalls (a deep thud and a creak of the joints), the screech (a tearing,
// formant-swept scream through a distortion), the beam's charge and burn,
// the swarm's chitter, a collapse's long rumble. Every call is safe without
// a started context (it does nothing).
export class ColossusAudio {
  constructor(audio) {
    this.audio = audio;
    this.drone = null;
    this._beam = null;
  }

  get ctx() {
    return this.audio?.ctx || null;
  }

  _bus() {
    const a = this.audio;
    return a?.buses?.creatures || a?.master || null;
  }

  // k = 1 / (1 + d / ref): a sound's level `d` blocks off.
  _k(d, ref = 160) {
    return 1 / (1 + Math.max(0, d) / ref);
  }

  // The drone, by the nearest colossus's distance (Infinity: off).
  setDrone(dist, enraged = false) {
    const ctx = this.ctx;
    const bus = this._bus();
    if (!ctx || !bus) return;
    const on = Number.isFinite(dist);
    if (!this.drone && !on) return;
    if (!this.drone) {
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(bus);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 140;
      lp.Q.value = 3;
      lp.connect(out);
      const o1 = ctx.createOscillator();
      o1.type = "sawtooth";
      o1.frequency.value = 31;
      const o2 = ctx.createOscillator();
      o2.type = "sawtooth";
      o2.frequency.value = 46.5;
      o1.connect(lp);
      o2.connect(lp);
      // A slow throb on the level.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.23;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.35;
      const throb = ctx.createGain();
      throb.gain.value = 0.65;
      lfo.connect(lfoG).connect(throb.gain);
      lp.disconnect();
      lp.connect(throb).connect(out);
      // The whine: a thin high sine, trembling.
      const w = ctx.createOscillator();
      w.type = "sine";
      w.frequency.value = 1730;
      const wg = ctx.createGain();
      wg.gain.value = 0.012;
      const trem = ctx.createOscillator();
      trem.frequency.value = 5.3;
      const tg = ctx.createGain();
      tg.gain.value = 0.009;
      trem.connect(tg).connect(wg.gain);
      w.connect(wg).connect(out);
      for (const o of [o1, o2, lfo, w, trem]) o.start();
      this.drone = { out, o1, o2, w, nodes: [o1, o2, lfo, w, trem] };
    }
    const d = this.drone;
    const t = ctx.currentTime;
    const level = on ? 0.5 * this._k(dist, 260) : 0;
    d.out.gain.setTargetAtTime(level, t, 0.6);
    d.o2.frequency.setTargetAtTime(enraged ? 52 : 46.5, t, 1.5);
    d.w.frequency.setTargetAtTime(enraged ? 2210 : 1730, t, 1.5);
    if (!on && level === 0) {
      // (Faded out: stopped a little later.)
      clearTimeout(this._stopT);
      this._stopT = setTimeout(() => {
        if (!this.drone || this.drone !== d || d.out.gain.value > 0.002) return;
        for (const o of d.nodes) o.stop();
        d.out.disconnect();
        this.drone = null;
      }, 4000);
    } else clearTimeout(this._stopT);
  }

  // A footfall `dist` blocks off (big: a collapse's thud).
  thud(dist, big = false) {
    const ctx = this.ctx;
    const bus = this._bus();
    if (!ctx || !bus) return;
    const k = this._k(dist, big ? 400 : 220);
    if (k < 0.03) return;
    const t = ctx.currentTime + Math.min(dist / 343, 2);
    const a = this.audio;
    const len = big ? 3.5 : 1.4;
    const src = a._noise(t, len);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(big ? 160 : 120, t);
    lp.frequency.exponentialRampToValueAtTime(30, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((big ? 1.4 : 0.8) * k, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(lp).connect(g).connect(bus);
    // A sub drop.
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(big ? 46 : 58, t);
    o.frequency.exponentialRampToValueAtTime(22, t + len * 0.8);
    const og = ctx.createGain();
    og.gain.setValueAtTime((big ? 0.9 : 0.5) * k, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + len * 0.8);
    o.connect(og).connect(bus);
    o.start(t);
    o.stop(t + len);
    // The joints creaking (a slow, resonant scrape).
    if (!big && Math.random() < 0.6) {
      const c = a._noise(t + 0.15, 0.9);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 18;
      bp.frequency.setValueAtTime(380 + Math.random() * 200, t + 0.15);
      bp.frequency.linearRampToValueAtTime(220 + Math.random() * 90, t + 1);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t + 0.15);
      cg.gain.exponentialRampToValueAtTime(0.25 * k, t + 0.4);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
      c.connect(bp).connect(cg).connect(bus);
    }
  }

  // The screech (a roar that stalls engines; `pitch` by the creature).
  screech(dist, pitch = 1) {
    const ctx = this.ctx;
    const bus = this._bus();
    if (!ctx || !bus) return;
    const k = this._k(dist, 300);
    if (k < 0.03) return;
    const t = ctx.currentTime + Math.min(dist / 343, 1.5);
    const dur = 2.6;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.audio._shaperCurve;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * k, t + 0.25);
    g.gain.setValueAtTime(0.5 * k, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    shaper.connect(g).connect(bus);
    for (const [f0, f1, f2, type] of [[260, 820, 190, "sawtooth"], [262, 840, 185, "square"], [131, 410, 96, "sawtooth"]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * pitch, t);
      o.frequency.exponentialRampToValueAtTime(f1 * pitch, t + 0.7);
      o.frequency.exponentialRampToValueAtTime(f2 * pitch, t + dur);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 4;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.linearRampToValueAtTime(2400, t + 0.8);
      bp.frequency.linearRampToValueAtTime(700, t + dur);
      const og = ctx.createGain();
      og.gain.value = 0.35;
      o.connect(bp).connect(og).connect(shaper);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    const n = this.audio._noise(t, dur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.value = 0.4;
    n.connect(hp).connect(ng).connect(shaper);
  }

  // The beam charging (rising, `dur` s) and burning (on: a harsh buzz until off).
  charge(dist, dur = 2.6) {
    const ctx = this.ctx;
    const bus = this._bus();
    if (!ctx || !bus) return;
    const k = this._k(dist, 260);
    if (k < 0.03) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(620, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * k, t + dur * 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(bp).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  setBeam(on, dist = 0) {
    const ctx = this.ctx;
    const bus = this._bus();
    if (!ctx || !bus) return;
    if (!on) {
      if (this._beam) {
        const b = this._beam;
        b.g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        setTimeout(() => b.nodes.forEach((o) => o.stop()), 500);
        this._beam = null;
      }
      return;
    }
    if (!this._beam) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(bus);
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 96;
      const o2 = ctx.createOscillator();
      o2.type = "square";
      o2.frequency.value = 143;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      o.start();
      o2.start();
      this._beam = { g, nodes: [o, o2] };
    }
    this._beam.g.gain.setTargetAtTime(0.22 * this._k(dist, 220), ctx.currentTime, 0.05);
  }

  // The swarm's chitter near the listener (n: how many within reach).
  chitter(n, dist) {
    const ctx = this.ctx;
    const bus = this._bus();
    if (!ctx || !bus || n <= 0) return;
    const k = this._k(dist, 40) * Math.min(1, 0.3 + n * 0.08);
    if (k < 0.02) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const s = this.audio._noise(t + i * 0.045, 0.05);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 9;
      bp.frequency.value = 2600 + Math.random() * 2400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.045);
      g.gain.exponentialRampToValueAtTime(0.16 * k, t + i * 0.045 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.045 + 0.05);
      s.connect(bp).connect(g).connect(bus);
    }
  }

  // A wet burst (a weak point destroyed, a sac bursting, an acid glob's splash).
  burst(dist, big = false) {
    const ctx = this.ctx;
    const bus = this._bus();
    if (!ctx || !bus) return;
    const k = this._k(dist, big ? 300 : 120);
    if (k < 0.03) return;
    const t = ctx.currentTime + Math.min(dist / 343, 1);
    const s = this.audio._noise(t, big ? 1.2 : 0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = "lowpass";
    bp.frequency.setValueAtTime(big ? 1800 : 2400, t);
    bp.frequency.exponentialRampToValueAtTime(90, t + (big ? 1.1 : 0.35));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((big ? 0.9 : 0.4) * k, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 1.15 : 0.4));
    s.connect(bp).connect(g).connect(bus);
    if (big) this.screech(dist, 0.55);
  }
}
