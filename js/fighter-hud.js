// (Round 13) The fighter HUD's targeting symbols, drawn on one canvas over
// the game while flying (and for the bazooka's lock on foot). (Round 14:
// the Round 12 lock box's look is back, small and thin, with only what
// helps from Round 13; nothing big in the middle of the screen.)
//   - the lock box: a small square on the target that closes in on it as
//     the lock builds (yellow), red and smaller once locked with LOCK over
//     it (a quick pop), its range beside it, the salvo's pips under it
//     (SALVO and a double box once the salvo is charged);
//   - auto aim's seeker: a small, faint broken ring round the crosshair;
//   - an arrow on the screen's edge when the target is off the screen;
//   - the warnings, small on the screen's edge: a chevron on the bearing
//     they come from, the word at the top: MISSILE (red, flashing, faster
//     when close), or LOCK (amber) when something has its nose on us.
// Crisp lines (device pixels), a dark edge under every line and letter so
// they read against a bright sky and at night, sizes that grow a little
// with the screen. It costs one clear and a few strokes a frame while
// flying, nothing otherwise.
import * as THREE from "three";

const YELLOW = "#ffd84a"; // (Round 12's lock box)
const LOCK = "#ff3a2a";
const AMBER = "#ffb02e";
const GREEN = "#a0ffbe";
const WHITE = "#f2fff6";
const EDGE = "rgba(0, 0, 0, 0.55)";
const FONT = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

const _p = new THREE.Vector3();

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
    // The lock box (eased): its middle, its full width; size 0 = none. (Tests read it.)
    this.box = { x: 0, y: 0, size: 0, ok: false };
    this.ring = 0; // the seeker ring's radius drawn (0 = none)
    this.pop = 1; // 0 -> 1 after a lock is made
    this.wasLocked = false;
    this.state = "";
    FighterHud.last = this; // (tests: the box's and the ring's sizes)
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
    // (Round 12's sizes at 720 lines, a little bigger on a big screen, never tiny.)
    this.s = clamp(Math.min(W, H) / 720, 0.85, 1.2);
  }

  _show(on) {
    if (on === this.shown) return;
    this.shown = on;
    this.canvas.classList.toggle("hidden", !on);
    if (!on) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.box.ok = false;
      this.box.size = 0;
      this.ring = 0;
      this._setState("", "");
    }
  }

  _setState(state, warn) {
    if (state !== this.state) this.canvas.dataset.state = this.state = state;
    if (warn !== this._warn) this.canvas.dataset.warn = this._warn = warn;
  }

  // Screen position of a world point: { x, y, behind, on }.
  _proj(world, camera, out = {}) {
    _p.copy(world).project(camera);
    out.behind = _p.z > 1;
    out.x = ((_p.x + 1) / 2) * this.w;
    out.y = ((1 - _p.y) / 2) * this.h;
    out.on = !out.behind && out.x > 0 && out.x < this.w && out.y > 0 && out.y < this.h;
    return out;
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
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    if (hud) this._drawFighter(hud, camera, dt);
    else this._drawSimpleLock(lock, dt);
  }

  // ---------- Drawing helpers ----------

  // Strokes the path `fn` makes: a thin dark edge first, then the colour.
  _stroke(fn, color, width, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha * 0.8;
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = width + 1.6;
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

  _text(str, x, y, color, size, align = "left", weight = 700, alpha = 1) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = EDGE;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.lineJoin = "miter";
    ctx.globalAlpha = 1;
  }

  // The lock box (Round 12's): a square `size` wide round (x, y); yellow and
  // closing in while the lock builds, red once locked with LOCK over it; a
  // double box and SALVO once the salvo is charged.
  _lockBox(x, y, size, locked, salvo, alpha = 1) {
    const s = this.s;
    const h = Math.round(size / 2) + 0.5; // (on the pixel grid: crisp)
    x = Math.round(x);
    y = Math.round(y);
    const color = salvo ? AMBER : locked ? LOCK : YELLOW;
    this._stroke((c) => c.rect(x - h, y - h, h * 2, h * 2), color, (locked ? 2 : 1.5) * s, alpha);
    if (salvo) {
      const g = h + 3 * s;
      this._stroke((c) => c.rect(x - g, y - g, g * 2, g * 2), color, 1.2 * s, alpha * (0.65 + 0.35 * Math.sin(this.t * 20)));
    }
    if (locked || salvo) this._text(salvo ? "SALVO" : "LOCK", x, y - h - (salvo ? 13 : 9) * s, color, 10.5 * s, "center", 800, alpha);
    return h;
  }

  // ---------- The jets' and the UFO's symbols ----------

  _drawFighter(hud, camera, dt) {
    const s = this.s;
    const W = this.w;
    const H = this.h;
    const bore = this._proj(hud.bore, camera, (this._bp ||= {}));
    const boreX = bore.behind ? W / 2 : bore.x;
    const boreY = bore.behind ? H / 2 : bore.y;
    const k = 1 - Math.exp(-dt * 16); // (the easing of the box's size)
    // Auto aim's seeker: small and faint round the crosshair (the cone it
    // catches in is a little wider: it never misleads, it only helps).
    const coneR = hud.cone > 0 ? (H / 2 / Math.tan(((camera.fov || 75) * Math.PI) / 360)) * Math.tan(hud.cone) : 0;
    this.ring = coneR ? Math.min(coneR, 22 * s) : 0;
    if (this.ring) this._seeker(boreX, boreY, this.ring, hud.target ? 0.3 : 0.45);
    let state = coneR ? "seek" : "";
    const T = hud.target;
    const b = this.box;
    if (T) {
      const tp = this._proj(T.pos, camera, (this._tp ||= {}));
      const locked = !!T.locked;
      state = locked ? "locked" : "locking";
      if (locked && !this.wasLocked) this.pop = 0;
      this.wasLocked = locked;
      this.pop = Math.min(1, this.pop + dt / 0.18);
      const salvo = !!T.salvo;
      // (Round 12's sizes: 64 closing to 34 while it builds, 32 locked.)
      const want = (locked ? 32 : 64 - 30 * easeOut(T.progress)) * s;
      if (tp.on) {
        if (!b.ok) b.size = want * 1.15;
        b.ok = true;
        b.x = tp.x;
        b.y = tp.y;
        b.size += (want - b.size) * k;
        const pop = locked ? 1 + 0.35 * (1 - easeOut(this.pop)) : 1;
        const h = this._lockBox(b.x, b.y, b.size * pop, locked, salvo);
        // The range, small beside it.
        this._text(fmtRange(T.dist), b.x + h + 5 * s, b.y - h + 5 * s, WHITE, 10 * s, "left", 700, 0.9);
        // The salvo's pips under the box (the jets' hold; the UFO's T).
        if (T.n > 1 && locked && (T.holding || salvo) && !T.auto) {
          const pw = 3 * s;
          const ph = 6 * s;
          const gap = 2 * s;
          const total = T.n * pw + (T.n - 1) * gap;
          const y0 = b.y + h + 5 * s;
          const filled = salvo ? T.n : T.pips;
          const ctx = this.ctx;
          for (let i = 0; i < T.n; i++) {
            const x0 = b.x - total / 2 + i * (pw + gap);
            ctx.fillStyle = EDGE;
            ctx.fillRect(x0 - 1, y0 - 1, pw + 2, ph + 2);
            ctx.fillStyle = i < filled ? AMBER : "rgba(255, 220, 160, 0.25)";
            ctx.fillRect(x0, y0, pw, ph);
          }
        }
      } else {
        b.ok = false;
        b.size = 0;
        this._edgeArrow(tp, T, locked ? LOCK : YELLOW);
      }
    } else {
      this.wasLocked = false;
      b.ok = false;
      b.size = 0;
    }
    // Threats, on the screen's edge.
    let warn = "";
    if (hud.threat?.kind === "missile" || hud.threat?.kind === "seeker") {
      warn = "missile";
      const close = hud.threat.dist < 350;
      const on = Math.sin(this.t * Math.PI * 2 * (close ? 5 : 2.2)) > -0.2;
      this._threatCue(hud.threat.pos, camera, LOCK, `${hud.threat.kind === "missile" ? "MISSILE" : "INCOMING"} ${fmtRange(hud.threat.dist)}`, on ? 1 : 0.3);
    } else if (hud.spiked) {
      warn = "spike";
      this._threatCue(hud.spiked.pos, camera, AMBER, `LOCK ${fmtRange(hud.spiked.dist)}`, 0.9);
    }
    this._setState(state, warn);
  }

  // The seeker: a thin ring broken into four arcs (a reticle, not a circle
  // to fill the view).
  _seeker(x, y, r, alpha) {
    const s = this.s;
    const gap = 0.32;
    this._stroke(
      (c) => {
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + Math.PI / 4;
          c.moveTo(x + Math.cos(a - Math.PI / 4 + gap) * r, y + Math.sin(a - Math.PI / 4 + gap) * r);
          c.arc(x, y, r, a - Math.PI / 4 + gap, a + Math.PI / 4 - gap);
        }
      },
      GREEN,
      1.1 * s,
      alpha
    );
  }

  // Where a world point lies on an ellipse just inside the screen's edge,
  // the way to turn to it (behind: mirrored): { x, y, a }.
  _edgeAt(tp, inset) {
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
    return { x: W / 2 + Math.cos(a) * (W / 2 - inset), y: H / 2 + Math.sin(a) * (H / 2 - inset), a };
  }

  // A small filled chevron at (x, y) pointing along angle a.
  _chevron(x, y, a, L, color, alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(L, 0);
    ctx.lineTo(-L * 0.6, -L * 0.7);
    ctx.lineTo(-L * 0.25, 0);
    ctx.lineTo(-L * 0.6, L * 0.7);
    ctx.closePath();
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = EDGE;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // The off-screen target: a chevron on the screen's edge pointing the way
  // to turn, with the range.
  _edgeArrow(tp, T, color) {
    const s = this.s;
    const e = this._edgeAt(tp, 26 * s);
    this._chevron(e.x, e.y, e.a, 8 * s, color);
    this._text(fmtRange(T.dist), e.x - Math.cos(e.a) * 22 * s, e.y - Math.sin(e.a) * 14 * s, color, 9.5 * s, "center", 700, 0.95);
  }

  // A threat: a chevron on the screen's edge on its bearing, and a word
  // with its range small at the top.
  _threatCue(pos, camera, color, label, alpha) {
    const s = this.s;
    const tp = this._proj(pos, camera, (this._wp ||= {}));
    // (On the screen: still at the edge, the way it lies from the middle.)
    if (!tp.behind && Math.abs(tp.x - this.w / 2) + Math.abs(tp.y - this.h / 2) < 1) tp.y = 0;
    const e = this._edgeAt(tp, 18 * s);
    this._chevron(e.x, e.y, e.a, 9 * s, color, alpha);
    // (The word on the top edge, in the middle: beside the chevron it could
    // fall under the flight panel or the radar on a small window.)
    this._text(label, this.w / 2, 40 * s, color, 11 * s, "center", 800, alpha);
  }

  // The bazooka's lock on foot (screen space only): the same box.
  _drawSimpleLock(lock, dt) {
    const s = this.s;
    const x = ((lock.x + 1) / 2) * this.w;
    const y = ((1 - lock.y) / 2) * this.h;
    const locked = !!lock.locked;
    if (locked && !this.wasLocked) this.pop = 0;
    this.wasLocked = locked;
    this.pop = Math.min(1, this.pop + dt / 0.18);
    const want = (locked ? 32 : 64 - 30 * easeOut(lock.progress ?? 0)) * s;
    const b = this.box;
    if (!b.ok) b.size = want * 1.15;
    b.ok = true;
    b.x = x;
    b.y = y;
    b.size += (want - b.size) * (1 - Math.exp(-dt * 16));
    this._lockBox(x, y, b.size * (locked ? 1 + 0.35 * (1 - easeOut(this.pop)) : 1), locked, false);
    this._setState(locked ? "locked" : "locking", "");
  }
}
