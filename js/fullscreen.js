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
// - (Round 12) The Fullscreen setting (Settings > Graphics, saved as
//   settings.fullscreen) and a Fullscreen button on the main and pause
//   menus. A page may only go fullscreen on a click, so with the setting on
//   the game goes fullscreen as it is entered (Play, Resume, "Click to play":
//   applySetting, from main.js's requestLock). F11, Alt+Enter and the buttons
//   set the setting too; leaving fullscreen some other way (the browser's
//   own Esc, which is the pause too) keeps it, and the next click into the
//   game goes back. With the keyboard locked, though, a plain Esc is the
//   game's: holding it to leave is the player's choice, the setting follows.
// - Outside fullscreen nothing can stop Ctrl+W, Ctrl+T or Ctrl+N (browsers
//   keep them): main.js asks "leave the page?" (beforeunload) mid-game.

const BLOCKED_COMBOS = new Set(["KeyR", "KeyS", "KeyD", "KeyF", "KeyG", "KeyP", "KeyU", "KeyA", "KeyH", "KeyJ", "KeyL", "KeyK", "KeyO", "KeyE", "KeyB", "KeyN", "KeyQ", "KeyW", "KeyT", "KeyI",
  // (Ctrl+digit would switch browser tabs while sprinting with Ctrl and picking a hotbar slot)
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
  // (Round 12: tab switching, the zoom, a new tab's address bar)
  "PageUp", "PageDown", "Minus", "Equal", "Digit0", "KeyM", "KeyY", "KeyZ", "KeyX", "KeyC", "KeyV", "Space"]);
// (Round 12) With the keyboard locked every Ctrl / Cmd combination is held
// back, in the menus too; a text field keeps these (copy, paste, undo...).
const EDIT_KEYS = new Set(["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "KeyY", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "Home", "End"]);
const editable = (el) => !!el && (el.isContentEditable || (el.tagName === "INPUT" && !["checkbox", "radio", "range", "button"].includes(el.type)) || el.tagName === "TEXTAREA");

export class FullscreenControl {
  /** @param {{isInGame: () => boolean, onChange?: (on: boolean) => void, settings?: object, save?: () => void}} opts */
  constructor(opts = {}) {
    this.isInGame = opts.isInGame || (() => false);
    this.onChange = opts.onChange || (() => {});
    // (Round 12) The live settings object (its `fullscreen`) and how to save it.
    this.settings = opts.settings || null;
    this.save = opts.save || (() => {});
    this.root = document.documentElement;
    this.supported = !!(this.root.requestFullscreen || this.root.webkitRequestFullscreen);
    this.keyboardLockSupported = !!(navigator.keyboard && navigator.keyboard.lock);
    this.keyboardLocked = false;
    this._build();
    this._bindMenus();
    document.addEventListener("fullscreenchange", () => this._changed());
    document.addEventListener("webkitfullscreenchange", () => this._changed());
    window.addEventListener("keydown", (e) => this._key(e), true);
    // (Esc held down: see _changed.)
    this._escHeld = false;
    window.addEventListener(
      "keyup",
      (e) => {
        if (e.code === "Escape") this._escHeld = false;
      },
      true
    );
    window.addEventListener("blur", () => (this._escHeld = false));
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
      this.userToggle();
      btn.blur();
    });
    zone.appendChild(btn);
    document.body.appendChild(zone);
    this.zone = zone;
    this.btn = btn;
    if (!this.supported) zone.classList.add("hidden");
  }

  // (Round 12) The menus' Fullscreen buttons and the setting's row.
  _bindMenus() {
    document.body.classList.toggle("no-fullscreen", !this.supported);
    this.menuBtns = [...document.querySelectorAll(".fs-toggle")];
    for (const b of this.menuBtns) {
      b.addEventListener("click", () => {
        this.userToggle();
        b.blur();
      });
    }
    this.checkbox = document.getElementById("fullscreen-setting");
    this.checkbox?.addEventListener("change", () => {
      const on = this.checkbox.checked;
      this._setWanted(on);
      // (The click on it is the gesture a page needs: at once, both ways.)
      if (on !== this.active) this.toggle();
    });
    this.hintEl = document.getElementById("fullscreen-hint");
    if (this.hintEl) {
      this.hintEl.textContent = !this.supported
        ? "This browser has no fullscreen for web pages."
        : this.keyboardLockSupported
          ? "Plays fullscreen, from the next click into the game (a page can't go fullscreen by itself; F11 or Alt+Enter switch too). In fullscreen the keyboard is the game's: Ctrl+W, Ctrl+R, Ctrl+T or Ctrl+N can't close or reload the page (hold Esc to leave fullscreen). Only fullscreen fully stops Ctrl+W: in a window, the browser asks before leaving mid-game."
          : "Plays fullscreen, from the next click into the game (a page can't go fullscreen by itself; F11 or Alt+Enter switch too). This browser can't give a page the keyboard (Chrome and Edge can): Ctrl+W can still close the tab, after the browser asks before leaving mid-game.";
    }
    this._refreshMenus();
  }

  _refreshMenus() {
    const on = this.active;
    for (const b of this.menuBtns || []) {
      b.textContent = on ? "Leave fullscreen" : "Fullscreen";
      b.title = on ? "Leave fullscreen (F11)" : "Fullscreen (F11)";
    }
    if (this.checkbox) this.checkbox.checked = this.wanted;
  }

  // (Round 12) The Fullscreen setting: the player wants to play fullscreen.
  get wanted() {
    return !!this.settings?.fullscreen;
  }

  _setWanted(on) {
    if (!this.settings || this.wanted === !!on) return;
    this.settings.fullscreen = !!on;
    this.save();
    this._refreshMenus();
  }

  // The setting as another tab of the game saved it (storage event: not saved again).
  adopt(on) {
    if (!this.settings || this.wanted === !!on) return;
    this.settings.fullscreen = !!on;
    this._refreshMenus();
  }

  // F11, Alt+Enter, the buttons: a switch the setting follows.
  userToggle() {
    if (!this.supported) return Promise.resolve(false);
    this._setWanted(!this.active);
    return this.toggle();
  }

  // Into the game (a click: main.js's requestLock) with the setting on:
  // fullscreen, if it isn't already. (Without a click the browser would say
  // no: nothing is asked then.)
  applySetting() {
    if (!this.wanted || this.active || !this.supported) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    this.toggle();
  }

  toggle() {
    if (!this.supported) return Promise.resolve(false);
    if (this.active) {
      this._selfExit = true; // (our own way out: the caller has set the setting)
      return Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(() => {
        this._selfExit = false;
      });
    }
    const req = this.root.requestFullscreen || this.root.webkitRequestFullscreen;
    return Promise.resolve(req.call(this.root, { navigationUI: "hide" })).catch(() => {});
  }

  _changed() {
    const on = this.active;
    // (Out of a keyboard-locked fullscreen by holding Esc: not a dialog, not our own switches.)
    if (!on && this._wasOn && !this._selfExit && this.keyboardLocked && this._escHeld) this._setWanted(false);
    if (!on) this._selfExit = false;
    this._wasOn = on;
    document.body.classList.toggle("is-fullscreen", on);
    this.btn.title = on ? "Leave fullscreen (F11)" : "Fullscreen (F11)";
    if (on) this._lockKeys();
    else this._unlockKeys();
    this._refreshMenus();
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
    if (e.code === "Escape") this._escHeld = true;
    if (e.code === "F11" || (e.code === "Enter" && e.altKey)) {
      e.preventDefault();
      if (!e.repeat) this.userToggle();
      return;
    }
    // (Round 12) Fullscreen with the keyboard locked: no browser shortcut
    // gets through at all (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab ...), menus too.
    if (this.keyboardLocked && this.active && (e.ctrlKey || e.metaKey) && !(editable(e.target) && EDIT_KEYS.has(e.code))) {
      e.preventDefault();
      return;
    }
    // Game key combinations a page is allowed to cancel (Ctrl+S save page,
    // Ctrl+D bookmark, Ctrl+R reload, Ctrl+F find, Alt shortcuts, Tab focus...).
    if (!this.isInGame()) return;
    if ((e.ctrlKey || e.metaKey) && BLOCKED_COMBOS.has(e.code) && !(editable(e.target) && EDIT_KEYS.has(e.code))) e.preventDefault();
    else if (e.code === "Tab" || (e.altKey && !e.ctrlKey && e.code !== "Enter")) e.preventDefault();
  }
}
