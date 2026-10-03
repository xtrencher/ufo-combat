// Snapshot interpolation: remote things (players, vehicles, UFOs, creatures)
// are drawn a little in the past, between the two received states around
// that moment, the way online action games hide network jitter. Every state
// carries its timestamp on the host's clock (session.time), so states from
// any peer can be placed on one timeline.
//
// The delay adapts: it is at least INTERP_DELAY and grows with how late the
// states arrive (a far client's states come through the host). Past the
// newest state the motion is extrapolated for a moment (a late packet), then
// it holds. A jump much farther than the speed allows (a respawn, a teleport,
// a dash) is not interpolated across: it snaps.
import { INTERP_DELAY, MAX_EXTRAPOLATE } from "./config.js";

const TAU = Math.PI * 2;
// Keys that are never blended (see Interp).
export const DISCRETE = ["f", "h", "o", "al", "n", "veh", "fx", "id"];

function lerpAngle(a, b, k) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
}

function slerpQuat(a, b, k, out) {
  let [ax, ay, az, aw] = a;
  let [bx, by, bz, bw] = b;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0;
  let k1;
  if (cos > 0.9995) {
    k0 = 1 - k;
    k1 = k;
  } else {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    k0 = Math.sin((1 - k) * th) / s;
    k1 = Math.sin(k * th) / s;
  }
  out[0] = ax * k0 + bx * k1;
  out[1] = ay * k0 + by * k1;
  out[2] = az * k0 + bz * k1;
  out[3] = aw * k0 + bw * k1;
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let i = 0; i < 4; i++) out[i] /= n;
  return out;
}

// A state is a flat object: numbers, 3-vectors (arrays), quaternions (4-arrays
// named in `quats`), angles (numbers named in `angles`); anything else is
// taken from the older state. `p` is the position, `v` the velocity (for
// extrapolation and the snap test).
export class Interp {
  // `discrete`: values that must never be blended (bit flags, item ids,
  // owners, states): a blend of two flag words reads as flags neither state
  // had (Round 8: a walking zombie between "on the ground" (4) and "on the
  // ground + has a target" (12) read 5..11, and the odd ones meant "dead").
  constructor({ angles = ["y", "pi"], quats = ["q"], snap = 40, discrete = DISCRETE } = {}) {
    this.buf = [];
    this.discrete = new Set(discrete);
    this.angles = new Set(angles);
    this.quats = new Set(quats);
    this.snap = snap; // blocks: a jump this much beyond what the speed explains snaps
    this.lag = INTERP_DELAY; // how late states arrive (s), smoothed
    this.last = null; // the newest state
    this.out = {};
  }

  get empty() {
    return this.buf.length === 0;
  }

  // A state arrived; `now` is the host clock now.
  push(state, now) {
    const ts = state.ts;
    if (!Number.isFinite(ts)) return;
    if (this.last && ts <= this.last.ts) {
      // Out of order (the fast channel is unordered): only if it fits in.
      if (this.buf.some((s) => s.ts === ts)) return;
      this.buf.push(state);
      this.buf.sort((a, b) => a.ts - b.ts);
    } else {
      this.buf.push(state);
      this.last = state;
    }
    if (this.buf.length > 40) this.buf.splice(0, this.buf.length - 40);
    const late = Math.max(0, now - ts);
    // Up fast, down slowly: a burst of late packets moves the delay at once.
    this.lag = late > this.lag ? this.lag * 0.6 + late * 0.4 : this.lag * 0.98 + late * 0.02;
  }

  // The delay states are drawn behind the clock.
  get delay() {
    return Math.min(0.6, Math.max(INTERP_DELAY, this.lag + 0.035));
  }

  // The state to draw at host time `now` (null before the first one).
  sample(now) {
    const buf = this.buf;
    if (!buf.length) return null;
    const t = now - this.delay;
    // Drop what is too old to matter (keep one before t).
    while (buf.length > 2 && buf[1].ts <= t) buf.shift();
    const out = this.out;
    const a = buf[0];
    if (buf.length === 1 || t <= a.ts) return this._copy(a, out, t > a.ts ? Math.min(t - a.ts, MAX_EXTRAPOLATE) : 0);
    const b = buf[1];
    if (t >= b.ts) return this._copy(b, out, Math.min(t - b.ts, MAX_EXTRAPOLATE));
    const k = (t - a.ts) / Math.max(1e-6, b.ts - a.ts);
    // A teleport between a and b: no sliding across the map.
    if (a.p && b.p) {
      const gap = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
      const sp = a.v ? Math.hypot(a.v[0], a.v[1], a.v[2]) : 0;
      if (gap > this.snap + sp * (b.ts - a.ts) * 2.5) return this._copy(k < 0.5 ? a : b, out, 0);
    }
    for (const key in b) {
      const va = a[key];
      const vb = b[key];
      if (this.discrete.has(key)) out[key] = k < 0.5 ? va ?? vb : vb;
      else if (typeof vb === "number" && typeof va === "number") out[key] = this.angles.has(key) ? lerpAngle(va, vb, k) : va + (vb - va) * k;
      else if (Array.isArray(vb) && Array.isArray(va) && va.length === vb.length) {
        if (this.quats.has(key) && vb.length === 4) out[key] = slerpQuat(va, vb, k, out[key] && out[key].length === 4 ? out[key] : [0, 0, 0, 1]);
        else {
          const arr = out[key] && out[key].length === vb.length ? out[key] : new Array(vb.length);
          for (let i = 0; i < vb.length; i++) arr[i] = va[i] + (vb[i] - va[i]) * k;
          out[key] = arr;
        }
      } else out[key] = k < 0.5 ? va ?? vb : vb;
    }
    out.ts = t;
    return out;
  }

  _copy(s, out, extra) {
    for (const key in s) {
      const val = s[key];
      out[key] = Array.isArray(val) ? val.slice() : val;
    }
    // A late packet: keep moving the way it was going (briefly).
    if (extra > 0 && s.p && s.v) for (let i = 0; i < 3; i++) out.p[i] += s.v[i] * extra;
    return out;
  }

  clear() {
    this.buf.length = 0;
    this.last = null;
  }
}

// Rounding for the wire (fewer characters in the JSON).
export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;
export const r1 = (v) => Math.round(v * 10) / 10;
export const vec2 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
export const vec1 = (v) => [r1(v.x), r1(v.y), r1(v.z)];
