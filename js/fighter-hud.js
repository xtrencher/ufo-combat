// (Round 13) The fighter HUD's targeting symbols, drawn on one canvas over
// the game while flying (and for the bazooka's lock on foot), in place of the
// old lock box and its spiral:
//   - the seeker circle: with auto aim, a faint circle round the crosshair
//     (the seeker's view: keep a target in it to lock it); it slides onto
//     the target and closes round it as the lock builds, its arc filling;
//   - the target designator: corner brackets that track the target (sized
//     to it), turning into a solid box with a diamond and a LOCK tag once
//     locked (with a quick pop), the target's name, range and closure
//     speed beside it, the salvo's pips under it;
//   - an arrow on the screen's edge when the target is off the screen;
//   - a marker on each of our guided missiles on its way, and its time to go;
//   - MISSILE (flashing, faster when close) with the bearing it comes from,
//     or LOCK when something has its nose on us.
// Crisp lines (device pixels), a dark edge under every line and letter so
// they read against a bright sky and at night, sizes that scale with the
// screen, everything eased. It costs one clear and a few dozen strokes a
// frame while flying, nothing otherwise.
import * as THREE from "three";

const GREEN = "#8dffb8";
const LOCK = "#ff5a3c";
const AMBER = "#ffc35a";
const WHITE = "#f2fff6";
const EDGE = "rgba(0, 8, 4, 0.6)";
const FONT = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function easeOut(t) {
  t = clamp(t, 0, 1);
  return 1 - (1 - t) * (1 - t) * (1 - t);
}
function fmtRange(d) {
  return d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} KM` : `${Math.round(d / 10) * 10} M`;
}

export class FighterHud {
  constructor(canvas = null) {
    if (!canvas && typeof document !== "undefined") {
      canvas = document.createElement("canvas");
      canvas.id = "fighter-hud";
      (document.getElementById("hud") || document.body).appendChild(canvas);
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.s = 1;
    this.shown = false;
    this.t = 0;
    this._last = 0;
    this.seek = { x: 0, y: 0, r: 0, ok: false };
    this.box = { x: 0, y: 0, hs: 0, ok: false, key: null };
    this.pop = 1; // 0 -> 1 after a lock is made
    this.wasLocked = false;
    this.state = "";
  }

  _resize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W !== this.w || H !== this.h || dpr !== this.dpr) {
      this.w = W;
      this.h = H;
      this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = `${W}px`;
      this.canvas.style.height = `${H}px`;
    }
    this.s = clamp(Math.min(W, H) / 600, 0.9, 2.4);
  }

  _show(on) {
    if (on === this.shown) return;
    this.shown = on;
    this.canvas.classList.toggle("hidden", !on);
    if (!on) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.seek.ok = false;
      this.box.ok = false;
      this._setState("", "");
    }
  }

  _setState(state, warn) {
    if (state !== this.state) this.canvas.dataset.state = this.state = state;
    if (warn !== this._warn) this.canvas.dataset.warn = this._warn = warn;
  }

  // Screen position of a world point: { x, y, behind }.
  _proj(world, camera, out = {}) {
    _p.copy(world).project(camera);
    out.behind = _p.z > 1;
    out.x = ((_p.x + 1) / 2) * this.w;
    out.y = ((1 - _p.y) / 2) * this.h;
    out.on = !out.behind && out.x > 0 && out.x < this.w && out.y > 0 && out.y < this.h;
    return out;
  }

  // Pixels per block at a world point (its depth in front of the camera).
  _pxPerBlock(world, camera) {
    camera.getWorldDirection(_f);
    const depth = Math.max(1, _d.copy(world).sub(camera.position).dot(_f));
    const fov = ((camera.fov || 75) * Math.PI) / 180;
    return this.h / 2 / Math.tan(fov / 2) / depth;
  }

  // A world direction's bearing on the screen (0 = up/ahead, clockwise, behind = PI).
  _bearing(world, camera) {
    camera.getWorldDirection(_f);
    _r.crossVectors(_f, camera.up).normalize();
    const d = _d.copy(world).sub(camera.position);
    return Math.atan2(d.dot(_r), d.dot(_f));
  }

  // opts: { vehicle, camera, overlay (vehicle.overlay(camera)), lock (a
  // screen-space lock { x, y, locked, progress }: the bazooka's), hidden }
  update({ vehicle = null, camera = null, overlay = null, lock = null, hidden = false } = {}) {
    const hud = overlay?.hud || null;
    const any = !hidden && camera && (hud || lock);
    if (!any) {
      this._show(false);
      return;
    }
    const now = performance.now() / 1000;
    const dt = clamp(now - (this._last || now), 0, 0.25);
    this._last = now;
    this.t += dt;
    this._resize();
    this._show(true);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (hud) this._drawFighter(hud, camera, dt);
    else this._drawSimpleLock(lock, dt);
  }

  // ---------- Drawing helpers ----------

  // Strokes the path `fn` makes: a dark edge first, then the colour.
  _stroke(fn, color, width, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = width + 2.2;
    ctx.beginPath();
    fn(ctx);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    fn(ctx);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _text(str, x, y, color, size, align = "left", weight = 600, alpha = 1) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.strokeStyle = EDGE;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  // Corner brackets round (x, y), half-size hs, corner length cl.
  _brackets(x, y, hs, cl) {
    return (c) => {
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = x + sx * hs;
        const cy = y + sy * hs;
        c.moveTo(cx, cy - sy * cl);
        c.lineTo(cx, cy);
        c.lineTo(cx - sx * cl, cy);
      }
    };
  }

  // The seeker: a faint full circle, the lock's progress as a bright arc
  // from the top (all of it once locked), four short ticks outside.
  _seeker(x, y, r, progress, color, alpha) {
    const s = this.s;
    this._stroke((c) => c.arc(x, y, r, 0, Math.PI * 2), color, 1.2 * s, alpha * 0.55);
    if (progress > 0.001) this._stroke((c) => c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress)), color, 2 * s, alpha);
    const t = 5 * s;
    this._stroke(
      (c) => {
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          c.moveTo(x + Math.cos(a) * (r + 2 * s), y + Math.sin(a) * (r + 2 * s));
          c.lineTo(x + Math.cos(a) * (r + 2 * s + t), y + Math.sin(a) * (r + 2 * s + t));
        }
      },
      color,
      1.5 * s,
      alpha
    );
  }

  // ---------- The jets' and the UFO's symbols ----------

  _drawFighter(hud, camera, dt) {
    const s = this.s;
    const W = this.w;
    const H = this.h;
    const bore = this._proj(hud.bore, camera, (this._bp ||= {}));
    const boreX = bore.behind ? W / 2 : bore.x;
    const boreY = bore.behind ? H / 2 : bore.y;
    const coneR = hud.cone > 0 ? clamp((H / 2 / Math.tan(((camera.fov || 75) * Math.PI) / 360)) * Math.tan(hud.cone), 18 * s, H * 0.3) : 0;
    const T = hud.target;
    const k = 1 - Math.exp(-dt * 14); // (the easing of every moving part)
    let state = coneR ? "seek" : "";
    if (T) {
      const tp = this._proj(T.pos, camera, (this._tp ||= {}));
      const rpx = (T.radius || 4) * this._pxPerBlock(T.pos, camera);
      const hs = clamp(rpx * 1.25, 15 * s, H * 0.22);
      const locked = !!T.locked;
      state = locked ? "locked" : "locking";
      if (locked && !this.wasLocked) this.pop = 0;
      this.wasLocked = locked;
      this.pop = Math.min(1, this.pop + dt / 0.22);
      const color = locked ? LOCK : GREEN;
      if (tp.on || (!tp.behind && tp.x > -hs && tp.x < W + hs && tp.y > -hs && tp.y < H + hs)) {
        // The designator box, following the target exactly (its size eased).
        const b = this.box;
        if (!b.ok || Math.hypot(b.x - tp.x, b.y - tp.y) > W * 0.3) {
          b.hs = hs;
          b.ok = true;
        }
        b.x = tp.x;
        b.y = tp.y;
        b.hs += (hs - b.hs) * k;
        const pop = locked ? 1 + 0.45 * (1 - easeOut(this.pop)) : 1;
        const h2 = b.hs * pop;
        if (locked) {
          const a = this.pop < 1 ? 0.6 + 0.4 * Math.sin(this.pop * 30) : 1;
          this._stroke((c) => c.rect(b.x - h2, b.y - h2, h2 * 2, h2 * 2), color, 2 * s, a);
          const dm = Math.max(4 * s, h2 * 0.22);
          const ctx = this.ctx;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y - dm);
          ctx.lineTo(b.x + dm, b.y);
          ctx.lineTo(b.x, b.y + dm);
          ctx.lineTo(b.x - dm, b.y);
          ctx.closePath();
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = EDGE;
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = EDGE;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1;
          // The LOCK tag over the box.
          const tw = 36 * s;
          const th = 14 * s;
          const ty = b.y - h2 - 7 * s - th / 2;
          ctx.fillStyle = EDGE;
          ctx.fillRect(b.x - tw / 2 - 1.5, ty - th / 2 - 1.5, tw + 3, th + 3);
          ctx.fillStyle = color;
          ctx.fillRect(b.x - tw / 2, ty - th / 2, tw, th);
          ctx.font = `800 ${Math.round(10.5 * s)}px ${FONT}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#1a0703";
          ctx.fillText("LOCK", b.x, ty + 0.5);
        } else {
          this._stroke(this._brackets(b.x, b.y, h2, Math.max(5 * s, h2 * 0.42)), color, 1.8 * s);
          // (A small cross at its middle while the lock builds.)
          const m = 3 * s;
          this._stroke((c) => {
            c.moveTo(b.x - m, b.y);
            c.lineTo(b.x + m, b.y);
            c.moveTo(b.x, b.y - m);
            c.lineTo(b.x, b.y + m);
          }, color, 1.2 * s, 0.8);
        }
        // Name, range, closure: beside the box.
        const tx = b.x + Math.max(h2, b.hs * 1.5 + 7 * s) + 9 * s; // (clear of the seeker and its ticks)
        const fs = 11.5 * s;
        const y0 = b.y - Math.max(h2, fs * 1.4);
        this._text(T.name || "TARGET", tx, y0 + fs * 0.55, color, fs, "left", 700);
        this._text(`R  ${fmtRange(T.dist)}`, tx, y0 + fs * 1.8, WHITE, fs * 0.92);
        this._text(`VC ${Math.round(T.closure * 3.6)}`, tx, y0 + fs * 2.95, WHITE, fs * 0.92);
        let line = 4.1;
        const mine = hud.missiles.filter((m) => m.onTarget);
        if (mine.length) {
          const ttg = Math.min(...mine.map((m) => m.ttg));
          this._text(`TTG ${ttg.toFixed(1)}`, tx, y0 + fs * line, AMBER, fs * 0.92, "left", 700);
          line += 1.15;
        }
        if (!locked) this._text(`${Math.round(T.progress * 100)}%`, tx, y0 + fs * line, GREEN, fs * 0.85, "left", 600, 0.85);
        // The salvo's pips under the box (the jets' hold; the UFO's T).
        if (T.n > 1 && locked && (T.holding || T.salvo) && !T.auto) {
          const pw = 5 * s;
          const ph = 11 * s;
          const gap = 3.5 * s;
          const total = T.n * pw + (T.n - 1) * gap;
          const y0 = b.y + h2 + 7 * s;
          const filled = T.salvo ? T.n : T.pips;
          const ctx = this.ctx;
          for (let i = 0; i < T.n; i++) {
            const x0 = b.x - total / 2 + i * (pw + gap);
            ctx.fillStyle = EDGE;
            ctx.fillRect(x0 - 1, y0 - 1, pw + 2, ph + 2);
            ctx.fillStyle = i < filled ? AMBER : "rgba(255, 220, 160, 0.18)";
            ctx.fillRect(x0, y0, pw, ph);
          }
          if (T.salvo) this._text(`SALVO x${T.n}`, b.x, y0 + ph + 10 * s, AMBER, 11 * s, "center", 800, 0.7 + 0.3 * Math.sin(this.t * 14));
        }
      } else {
        this.box.ok = false;
        this._edgeArrow(tp, T, color);
      }
      // The seeker: from the crosshair onto the target as the lock builds.
      const sk = this.seek;
      const onScreen = !tp.behind && tp.x > 0 && tp.x < W && tp.y > 0 && tp.y < H;
      const e = locked ? 1 : easeOut(T.progress * 1.6);
      const startR = coneR || Math.max(hs * 2.8, 46 * s);
      const gx = onScreen ? (coneR ? boreX + (tp.x - boreX) * e : tp.x) : boreX;
      const gy = onScreen ? (coneR ? boreY + (tp.y - boreY) * e : tp.y) : boreY;
      const gr = onScreen ? startR + (hs * 1.5 - startR) * e : coneR || 40 * s;
      if (!sk.ok) Object.assign(sk, { x: gx, y: gy, r: gr, ok: true });
      sk.x += (gx - sk.x) * k;
      sk.y += (gy - sk.y) * k;
      sk.r += (gr - sk.r) * k;
      this._seeker(sk.x, sk.y, sk.r, T.progress, color, 0.95);
    } else {
      this.wasLocked = false;
      this.box.ok = false;
      if (coneR) {
        const sk = this.seek;
        if (!sk.ok) Object.assign(sk, { x: boreX, y: boreY, r: coneR, ok: true });
        sk.x += (boreX - sk.x) * k;
        sk.y += (boreY - sk.y) * k;
        sk.r += (coneR - sk.r) * k;
        this._seeker(sk.x, sk.y, sk.r, 0, GREEN, 0.55);
      } else this.seek.ok = false;
    }
    // Our missiles on their way.
    for (const m of hud.missiles) {
      const p = this._proj(m.pos, camera, (this._mp ||= {}));
      if (!p.on) continue;
      const d = 4.5 * s;
      this._stroke((c) => {
        c.moveTo(p.x, p.y - d);
        c.lineTo(p.x + d, p.y);
        c.lineTo(p.x, p.y + d);
        c.lineTo(p.x - d, p.y);
        c.closePath();
      }, WHITE, 1.4 * s);
    }
    // Threats.
    let warn = "";
    if (hud.threat?.kind === "missile" || hud.threat?.kind === "seeker") {
      warn = "missile";
      const close = hud.threat.dist < 350;
      const on = Math.sin(this.t * Math.PI * 2 * (close ? 5 : 2.2)) > -0.2;
      this._threatCue(hud.threat.pos, camera, LOCK, on ? 1 : 0.35);
      if (on) this._warnBox(hud.threat.kind === "missile" ? "MISSILE" : "INCOMING", fmtRange(hud.threat.dist), LOCK, 1.15);
    } else if (hud.spiked) {
      warn = "spike";
      this._threatCue(hud.spiked.pos, camera, AMBER, 0.9);
      this._warnBox("LOCK", fmtRange(hud.spiked.dist), AMBER, 0.85);
    }
    this._setState(state, warn);
  }

  // The off-screen target: a chevron on the screen's edge (an ellipse just
  // inside it) pointing the way to turn, with the range.
  _edgeArrow(tp, T, color) {
    const s = this.s;
    const W = this.w;
    const H = this.h;
    let ax = tp.x - W / 2;
    let ay = tp.y - H / 2;
    if (tp.behind) {
      ax = -ax;
      ay = -ay;
      if (Math.abs(ax) + Math.abs(ay) < 1) ay = H;
    }
    const a = Math.atan2(ay, ax);
    const rx = W / 2 - 42 * s;
    const ry = H / 2 - 42 * s;
    const x = W / 2 + Math.cos(a) * rx;
    const y = H / 2 + Math.sin(a) * ry;
    const L = 13 * s;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const tri = (c) => {
      c.moveTo(L, 0);
      c.lineTo(-L * 0.6, -L * 0.75);
      c.lineTo(-L * 0.2, 0);
      c.lineTo(-L * 0.6, L * 0.75);
      c.closePath();
    };
    ctx.beginPath();
    tri(ctx);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = EDGE;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    this._text(`${T.name || ""} ${fmtRange(T.dist)}`.trim(), x - Math.cos(a) * 26 * s, y - Math.sin(a) * 20 * s, color, 10 * s, "center", 700);
  }

  // A threat's bearing: a triangle on a ring round the screen's middle.
  _threatCue(pos, camera, color, alpha) {
    const s = this.s;
    const b = this._bearing(pos, camera);
    const R = Math.min(this.w, this.h) * 0.2;
    const x = this.w / 2 + Math.sin(b) * R;
    const y = this.h / 2 - Math.cos(b) * R;
    const L = 11 * s;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b);
    ctx.beginPath();
    ctx.moveTo(0, -L);
    ctx.lineTo(L * 0.8, L * 0.55);
    ctx.lineTo(-L * 0.8, L * 0.55);
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = EDGE;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // A boxed warning word, low in the middle of the screen, with a line under it.
  _warnBox(word, sub, color, size) {
    const s = this.s * size;
    const x = this.w / 2;
    const y = this.h * 0.69;
    const ctx = this.ctx;
    ctx.font = `800 ${Math.round(17 * s)}px ${FONT}`;
    const tw = ctx.measureText(word).width + 22 * s;
    const th = 26 * s;
    this._stroke((c) => c.rect(x - tw / 2, y - th / 2, tw, th), color, 2 * this.s);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.fillRect(x - tw / 2, y - th / 2, tw, th);
    ctx.globalAlpha = 1;
    this._text(word, x, y + 1, color, 17 * s, "center", 800);
    if (sub) this._text(sub, x, y + th / 2 + 10 * this.s, color, 10.5 * this.s, "center", 700);
  }

  // The bazooka's lock on foot (screen space only): the box and the seeker.
  _drawSimpleLock(lock, dt) {
    const s = this.s;
    const x = ((lock.x + 1) / 2) * this.w;
    const y = ((1 - lock.y) / 2) * this.h;
    const color = lock.locked ? LOCK : GREEN;
    const hs = 17 * s;
    if (lock.locked) this._stroke((c) => c.rect(x - hs, y - hs, hs * 2, hs * 2), color, 2 * s);
    else this._stroke(this._brackets(x, y, hs, hs * 0.42), color, 1.8 * s);
    const r = hs * 1.5 + (1 - (lock.progress ?? 0)) * hs * 1.6;
    this._seeker(x, y, r, lock.locked ? 1 : lock.progress ?? 0, color, 0.95);
    if (lock.locked) this._text("LOCK", x, y - hs - 10 * s, color, 11 * s, "center", 800);
    this._setState(lock.locked ? "locked" : "locking", "");
  }
}
