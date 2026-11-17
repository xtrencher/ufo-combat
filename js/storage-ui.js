// (Round 20) A full browser storage, made visible and fixable.
//
// - The warning: while the world's saves fail (storage.js storeItem: the
//   browser's ~5 MB for the site is full even after the rebuildable data
//   went), a bar stays at the top of the screen, over the death screen too,
//   with a "Free space" button. It goes once a save fits again ("Saved").
// - The storage screen ("Saved worlds" on the main menu and the pause menu,
//   and the bar's button): how full the storage is, every saved world with
//   its size, type and when it was last saved, a Delete for each one but the
//   world being played (two clicks), and the canyon run's ghost replays.
//   After a delete main.js saves at once (onFreed).
// Its own styles and markup are put on the page here (above the death
// screen, z-index 130-140).
import { storageReport, deleteWorld, deleteGhosts } from "./storage.js";

const CSS = `
#save-warning { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 130; display: flex; align-items: center; gap: 10px; max-width: min(94vw, 760px); padding: 8px 12px; background: rgba(120,18,12,0.94); border: 1px solid #ff8a70; border-radius: 6px; color: #fff; font-size: 14px; line-height: 1.35; box-shadow: 0 4px 18px rgba(0,0,0,0.5); }
#save-warning.hidden { display: none; }
#save-warning b { color: #ffd76b; }
#save-warning .btn { flex: none; padding: 6px 12px; font-size: 13px; background: #b3261e; border: 1px solid #ff8a80; }
#storage-screen { z-index: 140; }
#storage-screen .panel { max-width: 640px; }
#storage-screen .st-bar { height: 10px; background: rgba(255,255,255,0.12); border-radius: 5px; overflow: hidden; margin: 6px 0 4px 0; }
#storage-screen .st-bar > div { height: 100%; background: #3d9bff; }
#storage-screen .st-bar.full > div { background: #e0483a; }
#storage-screen .st-sum { font-size: 12px; opacity: 0.8; margin-bottom: 12px; }
#storage-list { max-height: 46vh; overflow-y: auto; border-top: 1px solid rgba(255,255,255,0.12); }
#storage-list .st-row { display: flex; align-items: center; gap: 10px; padding: 7px 2px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 13px; }
#storage-list .st-name { flex: 1; min-width: 0; }
#storage-list .st-name small { display: block; opacity: 0.6; font-size: 11px; }
#storage-list .st-size { flex: none; width: 74px; text-align: right; font-variant-numeric: tabular-nums; opacity: 0.85; }
#storage-list .btn { flex: none; padding: 5px 10px; font-size: 12px; }
#storage-list .btn.confirm { background: #b3261e; }
#storage-list .st-here { flex: none; font-size: 11px; color: #ffd76b; width: 64px; text-align: center; }
#storage-screen .st-note { font-size: 12px; opacity: 0.7; margin-top: 10px; line-height: 1.4; }
.st-link { background: none; border: none; color: #8ec5ff; cursor: pointer; font-size: 12px; padding: 2px 4px; text-decoration: underline; }
`;

// localStorage holds about 5 million characters per site in the browsers the
// game runs in (Chrome, Edge, Firefox, Safari): the bar's scale.
export const STORAGE_LIMIT_CHARS = 5 * 1024 * 1024;
const TYPE_NAMES = { missions: "Missions world", survival: "Survival world" };

export function formatChars(n) {
  // (characters, as the quota counts them: shown as bytes, "about 5 MB" in all)
  const kb = n / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

function ago(ms) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return "saved just now";
  if (s < 5400) return `saved ${Math.round(s / 60)} min ago`;
  if (s < 129600) return `saved ${Math.round(s / 3600)} h ago`;
  return `saved ${Math.round(s / 86400)} days ago`;
}

export class StorageUI {
  // seed: the world being played (never deletable here); onFreed(): space
  // was freed (main.js saves at once); audio: clicks.
  constructor({ seed, onFreed = null, audio = null, guest = false } = {}) {
    this.seed = String(seed);
    this.onFreed = onFreed;
    this.audio = audio;
    this.guest = guest;
    this.failing = false;
    this._armed = null; // the Delete button clicked once
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    // The warning bar.
    const bar = document.createElement("div");
    bar.id = "save-warning";
    bar.className = "hidden";
    bar.setAttribute("role", "alert");
    bar.innerHTML = `<span><b>This world is not being saved:</b> the browser's storage for this site is full (or blocked). Free some space (delete old worlds) to keep your progress.</span><button class="btn" type="button" id="save-warning-btn">Free space</button>`;
    document.body.appendChild(bar);
    this.bar = bar;
    bar.querySelector("button").addEventListener("click", () => this.open());
    // The screen.
    const scr = document.createElement("div");
    scr.id = "storage-screen";
    scr.className = "overlay hidden";
    scr.innerHTML = `<div class="panel"><h2>Saved worlds &amp; storage</h2>
      <div class="st-bar"><div></div></div><div class="st-sum" id="storage-sum"></div>
      <div id="storage-list"></div>
      <div class="st-note">Everything is kept in this browser's storage for the site (about 5 MB, shared with any other game on the same site). Deleting a world removes it for good.</div>
      <div class="menu-buttons"><button class="btn secondary" type="button" id="storage-close">Close</button></div></div>`;
    document.body.appendChild(scr);
    this.screen = scr;
    this.list = scr.querySelector("#storage-list");
    scr.querySelector("#storage-close").addEventListener("click", () => this.close());
    scr.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        e.stopPropagation();
        this.close();
      }
    });
    this.list.addEventListener("click", (e) => this._click(e));
    // "Saved worlds" on the main menu (next to New world) and the pause menu.
    const link = (id, after) => {
      if (!after) return;
      const b = document.createElement("button");
      b.className = "st-link";
      b.type = "button";
      b.id = id;
      b.textContent = "Saved worlds";
      b.title = "The worlds kept in this browser, their sizes, and space to free";
      b.addEventListener("click", () => this.open());
      after.after(b);
    };
    link("menu-storage-btn", document.getElementById("new-world-btn"));
    if (!guest) link("pause-storage-btn", document.getElementById("main-menu-btn")?.parentElement);
  }

  get isOpen() {
    return !this.screen.classList.contains("hidden");
  }

  // main.js after every save: whether the world's data was all stored.
  report(ok) {
    if (this.guest) return;
    if (!ok && !this.failing) {
      this.failing = true;
      this.bar.classList.remove("hidden");
    } else if (ok && this.failing) {
      this.failing = false;
      this.bar.classList.add("hidden");
      return "recovered";
    }
    return null;
  }

  open() {
    this.audio?.playClick?.();
    this._armed = null;
    this.render();
    this.screen.classList.remove("hidden");
    this.screen.querySelector("#storage-close").focus?.();
  }

  close() {
    this.screen.classList.add("hidden");
  }

  render() {
    const r = storageReport();
    const used = Math.min(1, r.total / STORAGE_LIMIT_CHARS);
    const barEl = this.screen.querySelector(".st-bar");
    barEl.firstElementChild.style.width = `${Math.round(used * 100)}%`;
    barEl.classList.toggle("full", used > 0.9 || this.failing);
    this.screen.querySelector("#storage-sum").textContent = `${formatChars(r.total)} used of about ${formatChars(STORAGE_LIMIT_CHARS)}${this.failing ? " — full: this world isn't being saved" : ""}`;
    const rows = [];
    for (const w of r.worlds) {
      const here = w.seed === this.seed;
      const name = `${TYPE_NAMES[w.type] || "World"} ${w.seed}`;
      const sub = [here ? "the world you are in" : "", w.hasPlayer ? ago(w.at) : "block changes only"].filter(Boolean).join(" · ");
      rows.push(`<div class="st-row" data-seed="${w.seed}"><div class="st-name">${name}<small>${sub}</small></div><div class="st-size">${formatChars(w.chars)}</div>${here ? `<span class="st-here">playing</span>` : `<button class="btn secondary" type="button" data-del="${w.seed}">Delete</button>`}</div>`);
    }
    if (r.ghosts.n) rows.push(`<div class="st-row"><div class="st-name">Canyon run ghost replays (${r.ghosts.n})<small>the best runs flown again beside you; the best times stay</small></div><div class="st-size">${formatChars(r.ghosts.chars)}</div><button class="btn secondary" type="button" data-del="ghosts">Delete</button></div>`);
    rows.push(`<div class="st-row"><div class="st-name">Settings, records and stats<small>kept</small></div><div class="st-size">${formatChars(r.other)}</div><span class="st-here"></span></div>`);
    this.list.innerHTML = rows.join("");
  }

  _click(e) {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    this.audio?.playClick?.();
    const what = b.dataset.del;
    // Two clicks: the first asks.
    if (this._armed !== what) {
      this._armed = what;
      for (const o of this.list.querySelectorAll("[data-del].confirm")) {
        o.classList.remove("confirm");
        o.textContent = "Delete";
      }
      b.classList.add("confirm");
      b.textContent = "Delete for good?";
      return;
    }
    this._armed = null;
    const freed = what === "ghosts" ? deleteGhosts() : deleteWorld(what);
    this.render();
    if (freed > 0) this.onFreed?.(freed);
  }
}
