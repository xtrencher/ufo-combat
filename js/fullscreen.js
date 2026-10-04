// Fullscreen control and the Keyboard Lock API.
//
// - A small button in the bottom-right corner (it fades in when the mouse is
//   near the corner, so it never sits over the game) and the F11 /
//   Alt+Enter hotkeys toggle fullscreen on the whole page.
// - While fullscreen, navigator.keyboard.lock() (Chromium browsers) hands the
//   browser shortcuts (Ctrl+W, Ctrl+R, Ctrl+S, Tab ...) to the game, so
//   sprinting with Ctrl+W or an accidental Ctrl+R does not touch the page.
//   Browsers without it (Firefox, Safari) just get plain fullscreen; the
//   game still calls preventDefault on the combinations a page may cancel.
// - With every key locked the browser also hands Esc to the page (hold Esc
//   to leave fullscreen), so the pause menu keeps working: see `onEscape`.

const BLOCKED_COMBOS = new Set(["KeyR", "KeyS", "KeyD", "KeyF", "KeyG", "KeyP", "KeyU", "KeyA", "KeyH", "KeyJ", "KeyL", "KeyK", "KeyO", "KeyE", "KeyB", "KeyN", "KeyQ", "KeyW", "KeyT", "KeyI",
  // (Ctrl+digit would switch browser tabs while sprinting with Ctrl and picking a hotbar slot)
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"]);

export class FullscreenControl {
  /** @param {{isInGame: () => boolean, onChange?: (on: boolean) => void}} opts */
  constructor(opts = {}) {
    this.isInGame = opts.isInGame || (() => false);
    this.onChange = opts.onChange || (() => {});
    this.root = document.documentElement;
    this.supported = !!(this.root.requestFullscreen || this.root.webkitRequestFullscreen);
    this.keyboardLockSupported = !!(navigator.keyboard && navigator.keyboard.lock);
    this.keyboardLocked = false;
    this._build();
    document.addEventListener("fullscreenchange", () => this._changed());
    document.addEventListener("webkitfullscreenchange", () => this._changed());
    window.addEventListener("keydown", (e) => this._key(e), true);
    this._changed();
  }

  get active() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  _build() {
    const zone = document.createElement("div");
    zone.id = "fs-zone";
    const btn = document.createElement("button");
    btn.id = "fs-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Toggle fullscreen (F11)");
    btn.title = "Fullscreen (F11)";
    btn.innerHTML =
      '<svg class="fs-enter" viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<svg class="fs-exit" viewBox="0 0 24 24" width="18" height="18"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
      btn.blur();
    });
    zone.appendChild(btn);
    document.body.appendChild(zone);
    this.zone = zone;
    this.btn = btn;
    if (!this.supported) zone.classList.add("hidden");
  }

  toggle() {
    if (!this.supported) return Promise.resolve(false);
    if (this.active) {
      return Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(() => {});
    }
    const req = this.root.requestFullscreen || this.root.webkitRequestFullscreen;
    return Promise.resolve(req.call(this.root, { navigationUI: "hide" })).catch(() => {});
  }

  _changed() {
    const on = this.active;
    document.body.classList.toggle("is-fullscreen", on);
    this.btn.title = on ? "Leave fullscreen (F11)" : "Fullscreen (F11)";
    if (on) this._lockKeys();
    else this._unlockKeys();
    this.onChange(on);
  }

  _lockKeys() {
    if (!this.keyboardLockSupported) return;
    // No argument: every key (including Esc, which then needs a long press to leave fullscreen).
    Promise.resolve(navigator.keyboard.lock())
      .then(() => {
        this.keyboardLocked = true;
      })
      .catch(() => {
        this.keyboardLocked = false;
      });
  }

  _unlockKeys() {
    if (!this.keyboardLockSupported) return;
    try {
      navigator.keyboard.unlock();
    } catch (e) {
      /* nothing to do */
    }
    this.keyboardLocked = false;
  }

  _key(e) {
    if (e.code === "F11" || (e.code === "Enter" && e.altKey)) {
      e.preventDefault();
      if (!e.repeat) this.toggle();
      return;
    }
    // Game key combinations a page is allowed to cancel (Ctrl+S save page,
    // Ctrl+D bookmark, Ctrl+R reload, Ctrl+F find, Alt shortcuts, Tab focus...).
    if (!this.isInGame()) return;
    if ((e.ctrlKey || e.metaKey) && BLOCKED_COMBOS.has(e.code)) e.preventDefault();
    else if (e.code === "Tab" || (e.altKey && !e.ctrlKey && e.code !== "Enter")) e.preventDefault();
  }
}
