// Binoculars: holding both mouse buttons zooms in strongly (like a
// spyglass), with a soft double-lens vignette and a rangefinder; letting go
// of either button snaps straight back to the normal view.
//
// The catch is that each button on its own does something (mine, attack,
// place a block, fire a weapon). So presses are routed through a small
// chord detector: a press is held back for a moment (CHORD_WINDOW) to see
// whether the other button follows. If it does, neither press ever reaches
// the game and the binoculars come up; if not, the press goes through a
// few hundredths of a second late, which is not noticeable. A quick click
// (released within the window) still goes through as a click. Pressing the
// second button while the first is already held down (mining, machine gun)
// also counts, once both have been held a moment: the first button's
// action is released, and the second one's never started.
export const CHORD_WINDOW = 0.07; // seconds

export class MouseChord {
  // press(button) / release(button): forward to the game. zoom(on): the
  // binoculars. now(): seconds.
  constructor({ press, release, zoom, now = () => performance.now() / 1000 }) {
    this.press = press;
    this.release = release;
    this.zoomFn = zoom;
    this.now = now;
    this.pending = new Map(); // button -> time pressed (not yet forwarded)
    this.held = new Set(); // buttons down and forwarded to the game
    this.suppressed = new Set(); // buttons down whose release must not reach the game
    this.zoomed = false;
    this.enabled = true;
  }

  static other(button) {
    return button === 0 ? 2 : 0;
  }

  down(button) {
    if (button !== 0 && button !== 2) {
      this.press(button);
      return;
    }
    if (!this.enabled) {
      this.held.add(button);
      this.press(button);
      return;
    }
    const other = MouseChord.other(button);
    if (this.pending.has(other)) {
      // Both pressed together: binoculars, and neither press goes through.
      this.pending.delete(other);
      this._startZoom([button, other]);
      return;
    }
    if (this.held.has(other)) {
      // The other button is already doing something: this one waits, and
      // if both stay down past the window, it becomes the binoculars.
      this.pending.set(button, this.now());
      this._againstHeld = button;
      return;
    }
    this.pending.set(button, this.now());
  }

  up(button) {
    if (button !== 0 && button !== 2) {
      this.release(button);
      return;
    }
    if (this.zoomed) {
      this._stopZoom();
      this.suppressed.delete(button);
      return;
    }
    if (this.suppressed.has(button)) {
      this.suppressed.delete(button);
      return;
    }
    if (this.pending.has(button)) {
      // A quick click: forward it whole.
      this.pending.delete(button);
      this.press(button);
      this.release(button);
      return;
    }
    if (this.held.delete(button)) this.release(button);
  }

  // Forwards presses whose window ran out without a chord.
  update() {
    if (this.pending.size === 0) return;
    const t = this.now();
    for (const [button, at] of this.pending) {
      if (t - at < CHORD_WINDOW) continue;
      this.pending.delete(button);
      const other = MouseChord.other(button);
      if (this._againstHeld === button && this.held.has(other)) {
        // Held both: the binoculars win over what the first one was doing.
        this._againstHeld = null;
        this.held.delete(other);
        this.release(other);
        this._startZoom([button, other]);
        continue;
      }
      this.held.add(button);
      this.press(button);
    }
  }

  _startZoom(buttons) {
    this.zoomed = true;
    for (const b of buttons) this.suppressed.add(b);
    this.zoomFn(true);
  }

  _stopZoom() {
    this.zoomed = false;
    this.zoomFn(false);
  }

  // Everything let go (pause, a menu, death): no stuck zoom or presses.
  reset() {
    this.pending.clear();
    for (const b of this.held) this.release(b);
    this.held.clear();
    this.suppressed.clear();
    this._againstHeld = null;
    if (this.zoomed) this._stopZoom();
  }
}

// The binocular view: zoomed field of view, slower mouse, the lens
// vignette and a rangefinder reading.
export class Binoculars {
  constructor(player, world) {
    this.player = player;
    this.world = world;
    this.strength = 6; // zoom factor (setting)
    this.active = false;
    this.el = document.getElementById("binocular-overlay");
    this.readingEl = document.getElementById("binocular-reading");
    this._t = 0;
  }

  set(on) {
    this.active = on;
    const p = this.player;
    if (on) {
      p.binocularFov = Math.max(4, p.baseFov / this.strength);
      p.binocularSens = 1 / Math.sqrt(this.strength * 1.6);
    } else {
      p.binocularFov = null;
      p.binocularSens = 1;
      // Back to the normal view at once (no ease out).
      p.snapFov();
    }
    this.el.classList.toggle("visible", on);
  }

  update(dt, visible = true) {
    this.el.classList.toggle("visible", this.active && visible);
    if (!this.active) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.2;
    const eye = this.player.getEyePosition();
    const hit = this.world.raycast(eye, this.player.getForwardVector(), 600, { solidOnly: true });
    this.readingEl.textContent = `${this.strength.toFixed(1)}x   RANGE ${hit ? `${Math.round(hit.distance)} m` : "---"}`;
  }
}

