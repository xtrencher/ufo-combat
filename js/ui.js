export function isMobileDevice() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const touch = navigator.maxTouchPoints > 0 && !window.matchMedia("(pointer: fine)").matches;
  const ua = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
  return (coarse && ua) || (touch && ua);
}

// (Round 11) "missions": the survival game of a Missions world; "survival":
// a Survival world's (vanilla).
export const MODE_HINTS = {
  missions: "The UFO war: a campaign of missions, loot, supply drops and vehicles. Health, fall damage and drowning. Start with a sword and pickaxe: skeletons drop the bow, supply crates bring guns, alien leaders carry alien weapons. Eat to heal.",
  survival: "Normal Minecraft: start with nothing, gather, craft and survive. No UFOs, missions or mod weapons in this world.",
  creative: "Unlimited blocks from the E palette, instant mining, flight (double-tap Space), no damage.",
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
    // A card of the other world type (Missions or Survival) picks a world of
    // that type instead: onPickType(type) (main.js), null for this world.
    this.worldType = "missions";
    this.pick = null; // { type, hint }: the other type's world, picked
    this._mode = "survival";
    this.onPickType = null;
    this.modeCards = [...document.querySelectorAll(".mode-card")];
    for (const card of this.modeCards) {
      card.addEventListener("click", () => {
        const type = card.dataset.type;
        if (type && type !== this.worldType) {
          this.onPickType?.(type);
          return;
        }
        if (this.pick) this.onPickType?.(null);
        this.modeSelect.value = card.dataset.mode;
        this.modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    this.pauseModeSelect = document.getElementById("pause-mode-select");
    this.pauseModeHintEl = document.getElementById("pause-mode-hint");
    this.scopeOverlayEl = document.getElementById("scope-overlay");
    this.crosshairEl = document.getElementById("crosshair");
    this._fpsFrames = 0;
    this._fpsTimer = 0;
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

  // The other type's world picked on the main menu ({ type, hint }), or null.
  setPick(pick) {
    this.pick = pick || null;
    this._refreshCards();
  }

  _refreshCards() {
    const mode = this._mode;
    const pick = this.pick;
    for (const card of this.modeCards) {
      const type = card.dataset.type;
      card.classList.toggle("active", pick ? type === pick.type : card.dataset.mode === mode && (!type || type === this.worldType));
    }
    const hint = MODE_HINTS[mode === "creative" ? "creative" : this.worldType] || "";
    this.modeHintEl.textContent = pick ? pick.hint : hint;
    this.pauseModeHintEl.textContent = hint;
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
