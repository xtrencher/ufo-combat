import { setSplash } from "./menu-logo.js";

export function isMobileDevice() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const touch = navigator.maxTouchPoints > 0 && !window.matchMedia("(pointer: fine)").matches;
  const ua = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
  return (coarse && ua) || (touch && ua);
}

// (Round 11) "missions": the survival game of a Missions world; "survival":
// a Survival world's (vanilla). (Round 12) The main menu's three cards are
// Survival, Creative (both a Survival world: plain Minecraft) and Missions
// (the mods add-on); "missionsCreative": a Missions world played in Creative.
export const MODE_HINTS = {
  survival: "Normal Minecraft: start with nothing, gather, craft and survive the nights. No UFOs, missions or mod weapons.",
  creative: "Creative, in plain Minecraft: every block from the E palette, instant mining, flight (double-tap Space), no damage.",
  missions: "The mods add-on, in a world of its own: the UFO war, a campaign of missions, loot, supply drops, mod weapons and vehicles. Start with a sword and a pickaxe; eat to heal. (Creative for it: Esc > Game mode.)",
  missionsCreative: "Creative in this Missions world: every block and item (the mod weapons too), flight, the call-ins, no damage. Esc > Game mode switches back.",
};

// Menus (start / pause), the FPS counter and the scope overlay. The
// hotbar, hearts and death screen live in hud.js.
export class UI {
  constructor() {
    this.hudEl = document.getElementById("hud");
    this.fpsEl = document.getElementById("fps-counter");
    this.startMenuEl = document.getElementById("start-menu");
    this.pauseMenuEl = document.getElementById("pause-menu");
    this.mobileBlockEl = document.getElementById("mobile-block");
    this.seedValueEl = document.getElementById("seed-value");
    this.pauseSeedValueEl = document.getElementById("pause-seed-value");
    this.renderDistanceInput = document.getElementById("render-distance");
    this.renderDistanceValueEl = document.getElementById("render-distance-value");
    this.playBtn = document.getElementById("play-btn");
    this.resumeBtn = document.getElementById("resume-btn");
    this.copyLinkBtn = document.getElementById("copy-link-btn");
    this.graphicsSelect = document.getElementById("graphics-preset");
    this.graphicsHintEl = document.getElementById("graphics-hint");
    this.startGraphicsSelect = document.getElementById("start-graphics-preset");
    this.startNoticeEl = document.getElementById("start-notice");
    this.modeSelect = document.getElementById("mode-select");
    this.modeHintEl = document.getElementById("mode-hint");
    // The mode cards on the main menu drive the (hidden) select. (Round 11)
    // A card of the other world type picks a world of that type instead:
    // onPickType(type, mode) (main.js), onPickType(null) for this world.
    // (Round 12) Each card is a world type and a mode: Survival and Creative
    // a Survival world's, Missions a Missions world's (in its own game).
    this.worldType = "missions";
    this.pick = null; // { type, mode, hint }: the other type's world, picked
    this._mode = "survival";
    this.onPickType = null;
    this._onShownType = null;
    this._shownType = null;
    this.modeCards = [...document.querySelectorAll(".mode-card")];
    for (const card of this.modeCards) {
      card.addEventListener("click", () => {
        const type = card.dataset.type || this.worldType;
        const mode = card.dataset.mode;
        if (type !== this.worldType) {
          this.onPickType?.(type, mode);
          return;
        }
        if (this.pick) this.onPickType?.(null);
        this.modeSelect.value = mode;
        this.modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    this.pauseModeSelect = document.getElementById("pause-mode-select");
    this.pauseModeHintEl = document.getElementById("pause-mode-hint");
    this.scopeOverlayEl = document.getElementById("scope-overlay");
    this.crosshairEl = document.getElementById("crosshair");
    // (Round 12) "Click to play" waits for the graphics: a click before they
    // are ready would start the game with nothing drawn (see setPreparing).
    this.clickToPlayEl = document.getElementById("click-to-play");
    this.clickToPlayEl?.addEventListener(
      "click",
      (e) => {
        if (this._preparing) e.stopImmediatePropagation();
      },
      true
    );
    this._fpsFrames = 0;
    this._fpsTimer = 0;
  }

  // (Round 12) The world type the main menu shows: the picked card's, else
  // this world's. fn(type) now and whenever it changes (the flyover's UFOs
  // come and go with it, main.js).
  get shownType() {
    return this.pick ? this.pick.type : this.worldType;
  }

  set onShownType(fn) {
    this._onShownType = fn;
    this._shownType = this.shownType;
    fn?.(this._shownType);
  }

  setModeShown(mode) {
    this._mode = mode;
    this.modeSelect.value = mode;
    this.pauseModeSelect.value = mode;
    this._refreshCards();
  }

  // (Round 11) This world's type: the cards, the hints and the selects' names
  // for its survival game ("Missions" or "Survival").
  setWorldType(type) {
    this.worldType = type === "survival" ? "survival" : "missions";
    const name = this.worldType === "survival" ? "Survival" : "Missions";
    for (const sel of [this.modeSelect, this.pauseModeSelect]) {
      const o = [...sel.options].find((x) => x.value === "survival");
      if (o) o.textContent = name;
    }
    this._refreshCards();
  }

  // The other type's world picked on the main menu ({ type, mode, hint }), or null.
  setPick(pick) {
    this.pick = pick || null;
    this._refreshCards();
  }

  // (A Missions world lights its Missions card in either mode; a Survival
  // world lights Survival or Creative.)
  _cardLit(card, type, mode) {
    const ct = card.dataset.type || this.worldType;
    if (ct !== type) return false;
    return type === "missions" && !this.pick ? true : (card.dataset.mode || "survival") === mode;
  }

  _refreshCards() {
    const mode = this._mode;
    const pick = this.pick;
    for (const card of this.modeCards) card.classList.toggle("active", pick ? this._cardLit(card, pick.type, pick.mode || "survival") : this._cardLit(card, this.worldType, mode));
    const hint = MODE_HINTS[mode === "creative" ? (this.worldType === "missions" ? "missionsCreative" : "creative") : this.worldType] || "";
    this.modeHintEl.textContent = pick ? pick.hint : hint;
    this.pauseModeHintEl.textContent = hint;
    const shown = this.shownType;
    if (shown !== this._shownType) {
      this._shownType = shown;
      this._onShownType?.(shown);
    }
    setSplash(shown);
  }

  updateFps(dt) {
    this._fpsFrames++;
    this._fpsTimer += dt;
    if (this._fpsTimer >= 0.5) {
      const fps = Math.round(this._fpsFrames / this._fpsTimer);
      this.fpsEl.textContent = `FPS: ${fps}`;
      this._fpsFrames = 0;
      this._fpsTimer = 0;
    }
  }

  showHud(show) {
    this.hudEl.classList.toggle("hidden", !show);
  }

  // While the graphics are being prepared (shaders compiling, see main.js),
  // Play and Resume wait for them.
  setPreparing(preparing) {
    this._preparing = preparing;
    for (const [btn, label] of [
      [this.playBtn, this.playLabel || "Play"],
      [this.resumeBtn, "Resume"],
    ]) {
      btn.disabled = preparing;
      btn.textContent = preparing ? "Preparing graphics\u2026" : label;
    }
    this._fitPlay();
    // (Round 12) And "Click to play" (a guest's join, a world opened from the menu).
    const ctp = this.clickToPlayEl;
    if (ctp) {
      ctp.classList.toggle("waiting", !!preparing);
      const b = ctp.querySelector("b");
      const small = ctp.querySelector("small");
      if (b) b.textContent = preparing ? "Loading the world\u2026" : "Click to play";
      if (small) small.textContent = preparing ? "Preparing the graphics: one moment." : "You're in the game. Click anywhere to take the controls.";
    }
  }

  // (A long label, e.g. "Continue Survival world", in a smaller type: one line.)
  _fitPlay() {
    this.playBtn.classList.toggle("long", this.playBtn.textContent.length > 16);
  }

  // "Play" or "Continue" (a saved world).
  setPlayLabel(label) {
    this.playLabel = label;
    if (!this._preparing) this.playBtn.textContent = label;
    this._fitPlay();
  }

  // A line under the start menu's graphics choice ("" hides it).
  setStartNotice(text) {
    this.startNoticeEl.textContent = text;
  }

  // A sniper scope overlay while zoomed: masks the screen to a circle and
  // hides the ordinary crosshair (the scope draws its own).
  setScoped(active) {
    if (active === this._scoped) return; // (called every frame: touch the DOM only on a change)
    this._scoped = active;
    this.scopeOverlayEl.classList.toggle("visible", active);
    this.crosshairEl.style.visibility = active ? "hidden" : "";
  }

  showStartMenu(seed) {
    this.seedValueEl.textContent = String(seed);
    this.startMenuEl.classList.remove("hidden");
  }

  hideStartMenu() {
    this.startMenuEl.classList.add("hidden");
  }

  showPauseMenu(seed, renderDistance) {
    this.pauseSeedValueEl.textContent = String(seed);
    this.renderDistanceInput.value = String(renderDistance);
    this.renderDistanceValueEl.textContent = String(renderDistance);
    this.pauseMenuEl.classList.remove("hidden");
  }

  hidePauseMenu() {
    this.pauseMenuEl.classList.add("hidden");
  }

  showMobileBlock() {
    this.mobileBlockEl.classList.remove("hidden");
  }
}
