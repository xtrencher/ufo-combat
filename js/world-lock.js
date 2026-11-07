// (Round 17) One tab per world. Every tab of the game keeps its whole world
// in memory and saves all of it (the player, the block edits) every few
// seconds and when it closes, so two tabs of the same world overwrote each
// other: play on in a new tab, close the old one, and the old tab's save
// (the inventory, the position and the rest as they were when the new tab
// opened) replaced the new tab's progress.
//
// As Minecraft's session lock, the newest tab wins: a tab that opens a
// world tells the others (a BroadcastChannel; the storage event where there
// is none), and a tab with that world open stops saving it at once and
// says so (main.js: "Play here" reloads it from the save, and takes the
// world back the same way). The tab that switches away has just saved
// (main.js saves on visibilitychange), so the new tab starts from all of it.
// Multiplayer guests and the canyon run save no world and take no part.

const CHANNEL = "ufocombat_worlds";
const KEY = "ufocombat_v1_world_open";

export class WorldLock {
  // onTaken(): this tab's world was opened in another tab (called once,
  // after ready(): not while the page is still starting).
  constructor(seed, onTaken) {
    this.seed = seed >>> 0;
    this.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.superseded = false;
    this._ready = false;
    this._fired = false;
    this._onTaken = onTaken;
    const hear = (m) => {
      if (!m || m.t !== "open" || m.seed !== this.seed || m.id === this.id || this.superseded) return;
      this.superseded = true;
      this._fire();
    };
    try {
      this.channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
    } catch {
      this.channel = null;
    }
    if (this.channel) this.channel.onmessage = (e) => hear(e.data);
    else if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key !== KEY || !e.newValue) return;
        try {
          hear(JSON.parse(e.newValue));
        } catch {
          // (not ours)
        }
      });
    }
  }

  // This tab has the world now: the others with it open stop saving it.
  claim() {
    const m = { t: "open", seed: this.seed, id: this.id, at: Date.now() };
    try {
      if (this.channel) this.channel.postMessage(m);
      else localStorage.setItem(KEY, JSON.stringify(m));
    } catch {
      // (no storage, no other tabs to tell)
    }
  }

  // The page has started: a takeover heard meanwhile is reported now.
  ready() {
    this._ready = true;
    this._fire();
  }

  _fire() {
    if (!this.superseded || !this._ready || this._fired) return;
    this._fired = true;
    this._onTaken?.();
  }
}
