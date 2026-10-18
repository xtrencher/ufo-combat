// The rules of the game online: they are the host's. The host's game mode
// (Missions, Survival, Creative or Dogfight), its rule settings (weapons,
// creatures, UFOs, vehicles, the clock: every Creative-only setting), its
// difficulty, its Mods switch and its clock (the time of day) go to every
// player when a player joins and whenever they change. (The world's type,
// Missions or Survival, comes with the welcome: net/multiplayer.js.) A
// guest's own settings are never overwritten: the host's values are applied
// on top and the guest's rows are locked ("set by the host") until they leave.
import { dayLength } from "../sky.js";

// (Round 11) The room's modes. The room plays the host's world, whose type
// is fixed: "survival" is that world's own game (named Missions in a
// Missions world, Survival in a Survival world), "creative", and "dogfight"
// (a Missions world only: jets and guns). ("missions" is taken as "survival".)
export const MODES = ["survival", "creative", "dogfight"];

export function roomModes(worldType) {
  return worldType === "survival" ? ["survival", "creative"] : ["survival", "creative", "dogfight"];
}

// A mode asked for, if the world of that type has it, or null.
export function roomMode(mode, worldType) {
  if (mode === "missions") mode = "survival";
  return roomModes(worldType).includes(mode) ? mode : null;
}

// What a mode is called in a world of that type.
export function modeName(mode, worldType) {
  if (mode === "survival") return worldType === "survival" ? "Survival" : "Missions";
  return { creative: "Creative", dogfight: "Dogfight" }[mode] || String(mode);
}

// The player's own mode in a room mode (Dogfight plays by Survival's rules, in a jet).
export function playerModeOf(mode) {
  return mode === "creative" ? "creative" : "survival";
}

export class RulesSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this._sig = "";
    this._t = 0;
    this._timeT = 0;
    this.net.on("rules", (m) => this._onRules(m));
    this.net.on("mode", (m) => this._onMode(m));
    this.net.on("time", (m) => this._onTime(m));
    this.net.registerSync("rules", {
      save: () => this._rules(),
      load: (m) => this._onRules(m),
    });
  }

  start() {
    const g = this.game;
    g.ui.pauseModeSelect.disabled = !this.net.isHost;
    if (this.net.isClient) {
      g.timeSlider?.input && (g.timeSlider.input.disabled = true);
      document.getElementById("time-lock") && (document.getElementById("time-lock").disabled = true);
    }
  }

  stop() {
    const g = this.game;
    g.ui.pauseModeSelect.disabled = false;
    if (g.timeSlider?.input) g.timeSlider.input.disabled = false;
    const lock = document.getElementById("time-lock");
    if (lock) lock.disabled = false;
    if (this.net.isClient || this._guestApplied) {
      g.settingsPanel.setHostRules(null);
      g.setHostDifficulty(null);
    }
  }

  // ---------- Host ----------

  _rules() {
    const g = this.game;
    return { t: "rules", mode: this.mp.mode, s: g.settingsPanel.ruleValues(), d: g.difficulty, mods: g.mods.enabled, pvp: this.mp.pvp !== false };
  }

  // The host's "PvP / friendly fire" rule.
  setPvp(on) {
    if (!this.net.isHost) return;
    this.mp.pvp = !!on;
    this._sig = "";
    this.mp.feed(`PvP / friendly fire: ${on ? "on" : "off"}`);
    this.mp.ui.refresh();
  }

  // The host picks the mode (the lobby, or the pause menu).
  setMode(mode) {
    mode = roomMode(mode, this.game.worldType);
    if (!this.net.isHost || !mode) return;
    const before = this.mp.mode;
    this.mp.mode = mode;
    // (The mode first: a guest has entered a Dogfight by the time its first
    // "df" state arrives, so that new match puts it in a jet.)
    this.net.broadcast({ t: "mode", mode });
    this._applyMode(mode, before);
    this._sig = "";
    this.mp.ui.refresh();
  }

  _applyMode(mode, before) {
    const g = this.game;
    const playerMode = playerModeOf(mode);
    if (g.player.mode !== playerMode && g.gameState !== "start") g.setMode(playerMode);
    else if (g.gameState === "start") {
      g.ui.modeSelect.value = playerMode;
      g.player.setMode(playerMode);
    }
    g.ui.pauseModeSelect.value = playerMode;
    this.mp.dogfight?.modeChanged(mode, before);
    if (mode !== before) this.mp.feed(`Game mode: ${modeName(mode, g.worldType)}`);
  }

  update(dt) {
    if (!this.net.isHost) return;
    // The rules, whenever they change (checked twice a second).
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 0.5;
      const r = this._rules();
      const sig = JSON.stringify(r);
      if (sig !== this._sig) {
        this._sig = sig;
        this.net.broadcast(r);
      }
    }
    // The clock, every two seconds.
    this._timeT -= dt;
    if (this._timeT <= 0) {
      this._timeT = 2;
      const sky = this.game.sky;
      this.net.broadcast({ t: "time", time: sky.time, scale: sky.timeScale ?? 1, locked: !!sky.locked, ts: this.net.time });
    }
  }

  // ---------- Guest ----------

  _onRules(m) {
    if (!m || this.net.isHost) return;
    const g = this.game;
    this._guestApplied = true;
    g.settingsPanel.setHostRules(m.s || {});
    g.setHostDifficulty(m.d || "normal");
    if (typeof m.mods === "boolean") g.setModsFromHost(m.mods);
    if (typeof m.pvp === "boolean" && m.pvp !== this.mp.pvp) {
      this.mp.pvp = m.pvp;
      this.mp.feed(`PvP / friendly fire: ${m.pvp ? "on" : "off"}`);
      this.mp.ui.refresh();
    }
    if (m.mode && m.mode !== this.mp.mode) this._onMode({ mode: m.mode });
    // (A Dogfight watcher is in Creative on purpose: left flying.)
    else if (m.mode && !this.mp.dogfight?.watching && this.game.player.mode !== playerModeOf(m.mode)) this._applyMode(m.mode, m.mode);
  }

  _onMode(m) {
    // (A mode this world can't have, e.g. from a host of another version: ignored.)
    if (this.net.isHost || !MODES.includes(m.mode) || roomMode(m.mode, this.game.worldType) !== m.mode) return;
    const before = this.mp.mode;
    this.mp.mode = m.mode;
    this._applyMode(m.mode, before);
    this.mp.ui.refresh();
  }

  _onTime(m) {
    if (this.net.isHost) return;
    const sky = this.game.sky;
    sky.locked = !!m.locked;
    sky.timeScale = m.scale ?? 1;
    // (The host's clock moved on while the message travelled.)
    const ahead = m.locked ? 0 : Math.max(0, this.net.time - (m.ts ?? this.net.time)) * (m.scale ?? 1);
    const target = m.time + ahead;
    const len = dayLength(); // (this world's day: a Survival world's is 20 minutes)
    let d = target - sky.time;
    if (Math.abs(d) > len / 2) d -= Math.sign(d) * len;
    // Small drift: eased in; a jump (a mission skipping to the night): at once.
    if (Math.abs(d) > 20) sky.time = ((target % len) + len) % len;
    else sky.time = (((sky.time + d * 0.5) % len) + len) % len;
  }
}
