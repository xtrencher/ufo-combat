// The Hacks screen (Round 15): the pause menu's Hacks button (with the
// Creative call-ins) opens it. Toggles, sliders and choices grouped as in
// js/hacks.js HACK_GROUPS, a few action buttons (an army, smite, the time of
// day), "Reset all", and a hacker-terminal look. Its styles are put on the
// page here; index.html only has the button and the empty screen.
import { HACK_DEFS, HACK_GROUPS } from "./hacks.js";

const CSS = `
#hacks-screen .hacks-panel { max-width: 860px; background: radial-gradient(120% 90% at 50% 0%, rgba(20,60,40,0.96), rgba(6,14,12,0.97)); border: 1px solid rgba(80,255,160,0.45); box-shadow: 0 0 34px rgba(60,255,150,0.18), inset 0 0 40px rgba(0,0,0,0.5); }
#hacks-screen h2.hacks-title { font-family: "Courier New", ui-monospace, monospace; letter-spacing: 0.35em; color: #6dffb0; text-shadow: 0 0 10px rgba(80,255,160,0.8), 2px 0 rgba(255,60,120,0.55), -2px 0 rgba(60,180,255,0.55); animation: hk-glitch 3.2s infinite steps(1); margin-bottom: 4px; }
@keyframes hk-glitch { 0%, 92%, 100% { transform: none; } 93% { transform: translate(2px, -1px) skewX(-6deg); } 95% { transform: translate(-2px, 1px); } 97% { transform: translate(1px, 0) skewX(4deg); } }
#hacks-screen .hacks-sub { font-size: 12px; opacity: 0.8; margin-bottom: 10px; font-family: "Courier New", ui-monospace, monospace; color: #b8ffd8; }
#hacks-screen .hacks-sub.warn { color: #ffd27a; opacity: 1; }
#hacks-body { columns: 3 240px; column-gap: 10px; max-height: 58vh; overflow-y: auto; padding-right: 4px; }
#hacks-body .hk-group { border: 1px solid rgba(80,255,160,0.22); border-radius: 6px; padding: 8px 10px; background: rgba(0,0,0,0.28); break-inside: avoid; margin-bottom: 10px; }
#hacks-body .hk-group h3 { margin: 0 0 6px 0; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #6dffb0; font-family: "Courier New", ui-monospace, monospace; }
#hacks-body .hk-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px; }
#hacks-body .hk-row.off { opacity: 0.45; }
#hacks-body .hk-row .hk-label { flex: 1; min-width: 0; }
#hacks-body .hk-row.stack { flex-direction: column; align-items: stretch; gap: 3px; }
#hacks-body .hk-row.stack .hk-range { width: 100%; }
#hacks-body .hk-row.stack .hk-range input { flex: 1; width: auto; }
#hacks-body .hk-row.stack .hk-choice { justify-content: flex-start; }
#hacks-body .hk-row .hk-hint { display: block; font-size: 11px; opacity: 0.6; }
#hacks-body .hk-switch { width: 44px; height: 22px; border-radius: 11px; border: 1px solid rgba(110,255,170,0.5); background: rgba(255,255,255,0.08); position: relative; cursor: pointer; flex: none; padding: 0; }
#hacks-body .hk-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #cfd8d4; transition: left 0.12s, background 0.12s; }
#hacks-body .hk-switch.on { background: rgba(60,255,150,0.35); box-shadow: 0 0 8px rgba(60,255,150,0.6); }
#hacks-body .hk-switch.on::after { left: 24px; background: #6dffb0; }
#hacks-body .hk-range { display: flex; align-items: center; gap: 6px; flex: none; }
#hacks-body .hk-range input { width: 92px; accent-color: #4dff9a; }
#hacks-body .hk-range .hk-val { min-width: 54px; text-align: right; font-family: "Courier New", ui-monospace, monospace; color: #6dffb0; font-size: 12px; }
#hacks-body .hk-choice { display: flex; flex-wrap: wrap; gap: 3px; justify-content: flex-end; }
#hacks-body .hk-choice button, #hacks-body .hk-act { font-size: 11px; padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(110,255,170,0.35); background: rgba(255,255,255,0.06); color: inherit; cursor: pointer; }
#hacks-body .hk-choice button.on { background: rgba(60,255,150,0.32); border-color: #6dffb0; color: #eafff3; }
#hacks-body .hk-acts { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 4px; }
#hacks-body .hk-act:hover, #hacks-body .hk-choice button:hover { border-color: #6dffb0; }
#hacks-screen .hk-ribbon { font-size: 11px; opacity: 0.75; margin-top: 8px; font-family: "Courier New", ui-monospace, monospace; }
#pause-hacks-btn { width: 100%; margin: 6px 0 2px 0; font-family: "Courier New", ui-monospace, monospace; letter-spacing: 0.25em; color: #6dffb0; border-color: rgba(80,255,160,0.55); text-shadow: 0 0 8px rgba(80,255,160,0.6); }
#hack-hud { position: fixed; left: 10px; bottom: 84px; z-index: 6; font: 12px "Courier New", ui-monospace, monospace; color: #b8ffd8; background: rgba(0,0,0,0.42); border: 1px solid rgba(80,255,160,0.35); border-radius: 4px; padding: 3px 7px; pointer-events: none; max-width: 60vw; }
#hack-hud .hk-tag { color: #6dffb0; letter-spacing: 0.15em; text-shadow: 0 0 6px rgba(80,255,160,0.8); }
#hack-hud.hidden, body.hud-off #hack-hud { display: none; }
body.hack-slowmo::after { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 5; box-shadow: inset 0 0 160px rgba(40,120,255,0.42); }
@media (max-width: 600px) { #hacks-body { columns: 1; } }
`;

export class HacksUI {
  // hacks: the HackSystem; openScreen(id): main.js's (opens over the pause menu).
  constructor(hacks, { openScreen, screens, audio } = {}) {
    this.hacks = hacks;
    this.audio = audio;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    this.body = document.getElementById("hacks-body");
    this.sub = document.getElementById("hacks-sub");
    document.getElementById("pause-hacks-btn")?.addEventListener("click", () => {
      audio?.playClick?.();
      openScreen?.("hacks-screen");
    });
    document.getElementById("hacks-reset")?.addEventListener("click", () => {
      audio?.playClick?.();
      hacks.reset();
    });
    if (screens) screens.onOpen["hacks-screen"] = () => this.render();
    hacks.listeners.push(() => this._refresh());
  }

  _click() {
    this.audio?.playClick?.();
  }

  render() {
    const h = this.hacks;
    if (!this.body) return;
    if (this.sub) {
      const off = !h.allowed;
      this.sub.classList.toggle("warn", off);
      this.sub.textContent = off
        ? "Hacks work in Creative only (switch the game mode below the pause menu's buttons). Survival turns them all off."
        : h.online
          ? `Yours alone: your weapons, body and vehicle. ${h.isHost ? "As the host, the clock and frozen creatures are yours too." : "The clock and frozen creatures are the host's; bullet time is single player."}`
          : "Creative cheats, kept with this world. Survival turns them all off.";
    }
    this.body.innerHTML = "";
    this.rows = new Map();
    for (const [g, title] of HACK_GROUPS) {
      const box = document.createElement("div");
      box.className = "hk-group";
      box.innerHTML = `<h3>${title}</h3>`;
      for (const d of HACK_DEFS.filter((x) => x.group === g)) box.appendChild(this._row(d));
      const acts = this._actions(g);
      if (acts) box.appendChild(acts);
      this.body.appendChild(box);
    }
    this._refresh();
  }

  _row(d) {
    const row = document.createElement("div");
    row.className = d.type === "toggle" ? "hk-row" : "hk-row stack";
    const label = document.createElement("div");
    label.className = "hk-label";
    label.textContent = d.label;
    if (d.hint) {
      const hint = document.createElement("span");
      hint.className = "hk-hint";
      hint.textContent = d.hint;
      label.appendChild(hint);
    }
    row.appendChild(label);
    const h = this.hacks;
    let ctl;
    if (d.type === "toggle") {
      ctl = document.createElement("button");
      ctl.type = "button";
      ctl.className = "hk-switch";
      ctl.title = d.label;
      ctl.addEventListener("click", () => {
        this._click();
        h.set(d.key, !h.values[d.key]);
      });
    } else if (d.type === "range") {
      ctl = document.createElement("div");
      ctl.className = "hk-range";
      const input = document.createElement("input");
      input.type = "range";
      input.min = d.min;
      input.max = d.max;
      input.step = d.step;
      const val = document.createElement("span");
      val.className = "hk-val";
      input.addEventListener("input", () => h.set(d.key, Number(input.value)));
      ctl.append(input, val);
    } else {
      ctl = document.createElement("div");
      ctl.className = "hk-choice";
      for (const [v, text] of d.options) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.dataset.v = String(v);
        b.addEventListener("click", () => {
          this._click();
          h.set(d.key, v);
        });
        ctl.appendChild(b);
      }
    }
    row.appendChild(ctl);
    this.rows.set(d.key, { row, ctl, d });
    return row;
  }

  // A group's buttons that do something at once.
  _actions(g) {
    const h = this.hacks;
    const mk = (list) => {
      const box = document.createElement("div");
      box.className = "hk-acts";
      for (const [text, fn, host] of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hk-act";
        b.textContent = text;
        if (host) b.dataset.host = "1";
        b.addEventListener("click", () => {
          this._click();
          if (!h.allowed) return;
          fn();
        });
        box.appendChild(b);
      }
      return box;
    };
    if (g === "world")
      return mk([
        ["Dawn", () => h.setTime(6), true],
        ["Noon", () => h.setTime(12), true],
        ["Dusk", () => h.setTime(18), true],
        ["Midnight", () => h.setTime(0), true],
      ]);
    if (g === "mobs")
      return mk([
        ["Spawn the army", () => h.ctx.toast?.(`${h.spawnArmy()} on their way`, 2)],
        ["Smite hostiles", () => h.ctx.toast?.(`Smote ${h.smite()}`, 2)],
      ]);
    return null;
  }

  _refresh() {
    if (!this.rows) return;
    const h = this.hacks;
    for (const { row, ctl, d } of this.rows.values()) {
      const v = h.values[d.key];
      row.classList.toggle("off", !h.allowed || !h.usable(d));
      if (d.type === "toggle") ctl.classList.toggle("on", !!v);
      else if (d.type === "range") {
        const input = ctl.querySelector("input");
        if (document.activeElement !== input) input.value = v;
        ctl.querySelector(".hk-val").textContent = d.fmt ? d.fmt(v) : v;
      } else for (const b of ctl.children) b.classList.toggle("on", b.dataset.v === String(v));
    }
    for (const b of this.body.querySelectorAll(".hk-act[data-host]")) b.disabled = !h.isHost || !h.allowed;
  }
}
