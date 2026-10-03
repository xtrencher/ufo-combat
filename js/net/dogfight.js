// Dogfight: every player flies a fighter jet, all against all. The host
// runs the match:
//   - a countdown, then everyone is put in an F-22 high over the arena (the
//     host's position when the match starts), spread out on a ring;
//   - shooting other players' jets counts (cannon, missiles: the shooter's
//     call, like every shot online), and the kill goes to whoever hit the
//     jet last in the 12 s before it went down (a crash while someone was on
//     your tail is their kill too);
//   - after a death a player is back in a jet near the arena 3 s later, no
//     menu, no clicking; nobody can climb out of their jet;
//   - the host sets the death limit (Multiplayer screen): a player who
//     reaches it is out and watches (flying freely, unseen by the others'
//     weapons); the last one in wins (or, if the last ones go down
//     together, the most kills);
//   - kills and deaths on a scoreboard (hold Tab), a kill feed, and a
//     results screen for everyone at the end ("VICTORY" / "DEFEAT"); the host
//     starts a new match from there or from the Multiplayer screen.
// No UFOs, enemy fighters, missions or supply drops during a Dogfight.
import { HOST_PID } from "./session.js";
import { MAX_HEALTH } from "../player.js";

const COUNTDOWN = 4; // seconds
const RESPAWN_DELAY = 3;
const KILL_WINDOW = 12000; // ms
const ARENA_RADIUS = 380; // blocks: where the jets are put out
const ARENA_ALT = 150; // blocks over the ground

export class Dogfight {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.deathLimit = 5;
    this.phase = "off"; // off | countdown | live | over
    this.scores = new Map(); // pid -> { k, d, out }
    this.center = null; // [x, y, z]
    this.startAt = 0; // host time the fight starts
    this.winner = 0;
    this.match = 0;
    this._respawnAt = null;
    this._sig = "";
    this._resultsShown = 0;
    this._tab = false;
    const net = this.net;
    net.on("df", (m) => this._onState(m));
    net.on("dfdeath", (m, from) => this._onDeath(from, m.killer | 0));
    net.registerSync("dogfight", {
      save: () => this._state(),
      load: (s) => s && this._onState(s),
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Tab" && this.mp.active && (this.game.gameState === "playing" || this.game.gameState === "dead")) {
        e.preventDefault();
        this._tab = true;
        this._renderBoard();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Tab") {
        this._tab = false;
        this._renderBoard();
      }
    });
    window.addEventListener("blur", () => {
      this._tab = false;
      this._renderBoard();
    });
  }

  get on() {
    return this.mp.active && this.mp.mode === "dogfight";
  }

  // The fight is on: no dropping your things, back in a jet after a death.
  get live() {
    return this.on && (this.phase === "live" || this.phase === "countdown") && !this.me?.out;
  }

  get me() {
    return this.scores.get(this.net.pid) || null;
  }

  // ---------- Mode ----------

  start() {
    if (this.on) this._enter();
  }

  stop() {
    if (this.phase !== "off") this._leave();
  }

  modeChanged(mode, before) {
    if (mode === "dogfight" && before !== "dogfight") this._enter();
    else if (mode !== "dogfight" && before === "dogfight") this._leave();
    else if (mode === "dogfight" && this.phase === "off") this._enter();
  }

  _enter() {
    const g = this.game;
    g.vehicles.pvp = true;
    g.vehicles.exitLocked = () => (this.live ? "No getting out in a dogfight!" : null);
    g.setSurvivalPaused(true);
    if (!g.mods.enabled && this.net.isHost) g.setModsEnabled(true);
    if (this.net.isHost) {
      // The sky is the players' alone.
      this._ufoWas = g.ufos.enabled;
      g.ufos.enabled = false;
      g.ufos.clear();
      g.enemyJets.enabled = false;
      for (const j of g.enemyJets.jets) g.vehicles.remove(j);
      this.restart();
    } else if (this.phase === "off") this.phase = "countdown";
    this.mp.feed("Dogfight! Everyone in a jet: shoot the others down.");
  }

  _leave() {
    const g = this.game;
    this.phase = "off";
    g.vehicles.pvp = false;
    g.vehicles.exitLocked = null;
    g.setSurvivalPaused(false);
    if (this.net.isHost || this._ufoWas !== undefined) {
      g.ufos.enabled = g.mods.enabled;
      g.enemyJets.enabled = true;
    }
    // A watcher (out of the match) gets their own mode back.
    if (this.watching) this._unwatch();
    this._respawnAt = null;
    this.scores.clear();
    document.getElementById("mp-countdown").classList.add("hidden");
    document.getElementById("mp-results").classList.add("hidden");
    this._renderBoard();
    this._deathScreen(false);
  }

  // ---------- Host ----------

  setDeathLimit(n) {
    if (!this.net.isHost) return;
    this.deathLimit = Math.max(1, Math.min(50, n | 0));
    this._broadcast();
  }

  // A new match: everyone's scores at 0, a countdown, everyone in a jet.
  restart() {
    if (!this.net.isHost) return;
    if (this.mp.mode !== "dogfight") {
      this.mp.rules.setMode("dogfight");
      return;
    }
    const g = this.game;
    this.match++;
    this.scores.clear();
    for (const p of this.net.players.values()) this.scores.set(p.pid, { k: 0, d: 0, out: false });
    const c = g.vehicles.active ? g.vehicles.active.pos : g.player.position;
    this.center = [Math.round(c.x), Math.round(c.y), Math.round(c.z)];
    this.phase = "countdown";
    this.startAt = this.net.time + COUNTDOWN;
    this.winner = 0;
    this._broadcast();
    this._newMatch();
  }

  // A new match here: the results go, a watcher flies again, a fresh jet.
  _newMatch() {
    const res = document.getElementById("mp-results");
    const wasShown = !res.classList.contains("hidden");
    res.classList.add("hidden");
    // (A guest whose results were up: one click back into the jet.)
    if (wasShown) this.game.showClickToPlay?.();
    this._resultsShown = 0;
    if (this.watching) this._unwatch();
    this._putInJet(true);
    this._renderBoard();
  }

  _state() {
    return { t: "df", match: this.match, phase: this.phase, limit: this.deathLimit, scores: [...this.scores].map(([pid, s]) => [pid, s.k, s.d, s.out ? 1 : 0]), center: this.center, startAt: this.startAt, winner: this.winner };
  }

  _broadcast() {
    if (this.net.isHost) this.net.broadcast(this._state());
    this.mp.ui.refresh();
  }

  playerJoined(p) {
    if (!this.net.isHost || !this.on) return;
    if (!this.scores.has(p.pid)) this.scores.set(p.pid, { k: 0, d: 0, out: this.phase === "over" });
    this._broadcast();
  }

  playerLeft(p) {
    if (!this.on) return;
    this.scores.delete(p.pid);
    if (this.net.isHost) {
      this._checkEnd();
      this._broadcast();
    }
    this._renderBoard();
  }

  // A player went down (the host's own death, or a guest's report).
  _onDeath(victim, killer) {
    if (!this.net.isHost || this.phase !== "live") return;
    const v = this.scores.get(victim);
    if (!v || v.out) return;
    v.d++;
    if (v.d >= this.deathLimit) v.out = true;
    const k = killer && killer !== victim ? this.scores.get(killer) : null;
    if (k) k.k++;
    const text = k ? `${this.mp.playerName(killer)} shot down ${this.mp.playerName(victim)}` : `${this.mp.playerName(victim)} went down`;
    this.mp.feed(text + (v.out ? " (out!)" : ""));
    this.net.broadcast({ t: "feed", text: text + (v.out ? " (out!)" : "") });
    this._checkEnd();
    this._broadcast();
  }

  _checkEnd() {
    if (this.phase !== "live") return;
    const all = [...this.scores.entries()];
    if (all.length < 2) return;
    const alive = all.filter(([, s]) => !s.out);
    if (alive.length > 1) return;
    // The last one in; if nobody is (both went down at once), the most kills.
    let winner = alive[0]?.[0];
    if (!winner) {
      all.sort((a, b) => b[1].k - a[1].k || a[1].d - b[1].d);
      winner = all[0][0];
    }
    this.winner = winner;
    this.phase = "over";
  }

  // ---------- Everyone ----------

  _onState(m) {
    if (!m || m.t !== "df") return;
    const before = this.phase;
    const newMatch = m.match !== this.match;
    this.match = m.match;
    this.phase = m.phase;
    this.deathLimit = m.limit;
    this.center = m.center;
    this.startAt = m.startAt;
    this.winner = m.winner;
    this.scores.clear();
    for (const [pid, k, d, out] of m.scores || []) this.scores.set(pid, { k, d, out: !!out });
    if (this.mp.mode !== "dogfight") return;
    if (newMatch && before !== "off" && !this.net.isHost) this._newMatch();
    if (this.me?.out && !this.watching && this.phase === "live") this._watch();
    this._renderBoard();
    this.mp.ui.refresh();
  }

  // This player died (main.js).
  died(cause) {
    if (!this.on || this.phase !== "live") return;
    const m = /^pvp@(\d+)$/.exec(cause) || /@(\d+)/.exec(cause);
    const killer = m ? Number(m[1]) : 0;
    if (this.net.isHost) this._onDeath(HOST_PID, killer);
    else this.net.toHost({ t: "dfdeath", killer });
    // (Real seconds: a slow computer's clamped frames don't stretch the wait.)
    this._respawnAt = performance.now() + RESPAWN_DELAY * 1000;
  }

  update(dt) {
    if (!this.on) return;
    const g = this.game;
    const now = this.net.time;
    // The end (the host decides it; everyone gets the results once).
    if (this.phase === "over" && this._resultsShown !== this.match) {
      this._resultsShown = this.match;
      this._showResults();
    }
    // Host: the countdown ends.
    if (this.net.isHost && this.phase === "countdown" && now >= this.startAt) {
      this.phase = "live";
      this._broadcast();
    }
    // The countdown on screen.
    const cd = document.getElementById("mp-countdown");
    const left = this.startAt - now;
    if (this.phase === "countdown" && left > 0) {
      cd.classList.remove("hidden");
      const html = `<small>DOGFIGHT</small>${Math.ceil(left)}`;
      if (cd.innerHTML !== html) cd.innerHTML = html;
    } else if (this.phase === "live" && left > -1.2) {
      cd.classList.remove("hidden");
      if (cd.textContent !== "FIGHT!") cd.textContent = "FIGHT!";
    } else cd.classList.add("hidden");
    // In a jet, always (unless out, or watching the results).
    if ((this.phase === "countdown" || this.phase === "live") && !this.me?.out && g.gameState !== "start") {
      if (g.player.dead) {
        if (!this._respawnAt) this._respawnAt = performance.now() + RESPAWN_DELAY * 1000;
        this._deathScreen(true);
        if (performance.now() >= this._respawnAt) {
          this._respawnAt = null;
          this._putInJet(false);
        }
      } else if (!g.vehicles.active && g.gameState !== "start") {
        this._jetT = (this._jetT ?? 0.3) - dt;
        if (this._jetT <= 0) {
          this._jetT = 1;
          this._putInJet(false);
        }
      }
    }
    if (this._tab) {
      this._boardT = (this._boardT ?? 0) - dt;
      if (this._boardT <= 0) {
        this._boardT = 0.5;
        this._renderBoard();
      }
    }
  }

  // Into a fresh jet high over the arena, on the ring at this player's place.
  _putInJet(fresh) {
    const g = this.game;
    if (g.gameState === "start") return;
    if (g.player.dead) {
      if (g.gameState !== "dead") return;
      g.respawn();
    }
    if (g.player.dead) return;
    const old = g.vehicles.active;
    if (old) {
      if (!fresh) return;
      g.vehicles.exit({ force: true });
      if (old.alive) g.vehicles.remove(old);
    }
    const c = this.center || [g.player.position.x, g.player.position.y, g.player.position.z];
    const ids = [...this.scores.keys()].sort((a, b) => a - b);
    const slot = Math.max(0, ids.indexOf(this.net.pid));
    const a = (slot / Math.max(2, ids.length)) * Math.PI * 2 + (fresh ? 0 : Math.random() * 0.8);
    const x = c[0] + Math.cos(a) * ARENA_RADIUS;
    const z = c[2] + Math.sin(a) * ARENA_RADIUS;
    const ground = Math.max(g.world.heightAt(Math.floor(x), Math.floor(z)), 64);
    const y = ground + ARENA_ALT + Math.random() * 30;
    const yaw = Math.atan2(-(c[0] - x), -(c[2] - z)); // toward the middle
    g.player.position.set(x, y, z);
    g.player.health = MAX_HEALTH;
    const jet = g.vehicles.create("jet", { jetType: "f22", pos: [x, y, z], yaw, airborne: true, speed: 150, throttle: 0.85 });
    if (!jet) return;
    g.vehicles.enter(jet);
    this._deathScreen(false);
  }

  // Out of the match: watching (free flight, unhurt, no jet, no weapons:
  // nobody's target and nobody's danger).
  _watch() {
    const g = this.game;
    this.watching = true;
    if (g.player.dead && g.gameState === "dead") g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.player.setMode("creative");
    g.weapons.enabled = false;
    g.weapons.cancel?.();
    g.player.flying = true;
    const c = this.center;
    if (c) g.teleport(c[0], Math.max(g.world.heightAt(Math.floor(c[0]), Math.floor(c[2])), 64) + 60, c[2]);
    g.player.flying = true;
    g.toast?.(`You're out (${this.deathLimit} deaths). Watching the rest of the match: hold Tab for the scores.`, 6);
    this._deathScreen(false);
  }

  _unwatch() {
    const g = this.game;
    this.watching = false;
    g.weapons.enabled = g.mods.enabled;
    g.player.setMode(this.mp.mode === "creative" ? "creative" : "survival");
    g.player.flying = false;
  }

  _deathScreen(on) {
    const btn = document.getElementById("respawn-btn");
    const near = document.getElementById("respawn-near-btn");
    if (btn) btn.classList.toggle("hidden", on);
    if (near && on) near.classList.add("hidden");
    let note = document.getElementById("df-respawn-note");
    if (!note && on) {
      note = document.createElement("div");
      note.id = "df-respawn-note";
      note.className = "mp-note";
      note.style.textAlign = "center";
      document.getElementById("death-cause")?.after(note);
    }
    if (note) {
      note.classList.toggle("hidden", !on);
      if (on) {
        const s = this.me;
        const text = `Back in a jet in ${Math.max(1, Math.ceil(((this._respawnAt ?? 0) - performance.now()) / 1000))}...  (deaths ${s ? s.d : 0}/${this.deathLimit})`;
        if (note.textContent !== text) note.textContent = text;
      }
    }
  }

  // ---------- Scoreboard and results ----------

  _rows() {
    const rows = [];
    for (const p of this.net.players.values()) {
      const s = this.scores.get(p.pid);
      rows.push({ pid: p.pid, nick: p.nick, color: p.color, ping: p.ping ?? 0, k: s?.k ?? 0, d: s?.d ?? 0, out: !!s?.out });
    }
    if (this.on) rows.sort((a, b) => b.k - a.k || a.d - b.d || a.pid - b.pid);
    else rows.sort((a, b) => a.pid - b.pid);
    return rows;
  }

  _table(rows, ping = true) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const df = this.on;
    let html = `<table class="mp-score"><tr><th>Player</th>${df ? "<th>Kills</th><th>Deaths</th>" : ""}${ping ? "<th>Ping</th>" : ""}</tr>`;
    for (const r of rows) {
      const cls = [r.pid === this.net.pid ? "me" : "", r.out ? "out" : ""].join(" ").trim();
      html += `<tr class="${cls}"><td><span style="color:${r.color}">&#9679;</span> ${esc(r.nick)}${r.pid === HOST_PID ? " <small style=\"opacity:.6\">(host)</small>" : ""}${r.out ? " <small style=\"opacity:.6\">(out)</small>" : ""}</td>${df ? `<td>${r.k}</td><td>${r.d}/${this.deathLimit}</td>` : ""}${ping ? `<td>${r.pid === this.net.pid ? "-" : `${r.ping} ms`}</td>` : ""}</tr>`;
    }
    return html + "</table>";
  }

  _renderBoard() {
    const el = document.getElementById("mp-scoreboard");
    const show = this._tab && this.mp.active;
    el.classList.toggle("hidden", !show);
    if (!show) return;
    const mode = this.on ? `Dogfight · out at ${this.deathLimit} deaths` : this.mp.mode === "creative" ? "Creative" : "Survival";
    el.innerHTML = `<div class="mp-score-title">Room ${this.net.code}<span>${mode}</span></div>${this._table(this._rows())}`;
  }

  _showResults() {
    const g = this.game;
    // (Down when the match ended: no death screen and no countdown under the results.)
    this._respawnAt = null;
    this._deathScreen(false);
    if (g.player.dead && g.gameState === "dead") g.respawn();
    const won = this.winner === this.net.pid;
    const big = document.getElementById("mp-result-big");
    big.textContent = won ? "VICTORY" : "DEFEAT";
    big.className = `mp-result-big ${won ? "win" : "lose"}`;
    const w = this.scores.get(this.winner);
    document.getElementById("mp-result-text").textContent = `${this.mp.playerName(this.winner)} wins${w ? ` with ${w.k} kill${w.k === 1 ? "" : "s"}` : ""}.${won ? " Nobody could touch you." : ""}`;
    document.getElementById("mp-result-table").innerHTML = this._table(this._rows(), false);
    document.getElementById("mp-result-again").classList.toggle("hidden", !this.net.isHost);
    document.getElementById("mp-results").classList.remove("hidden");
    g.audio?.playMission?.();
    // The mouse is for the buttons now: no more flying, no pause menu over the results.
    g.vehicles.releaseAll?.();
    if (document.pointerLockElement) document.exitPointerLock();
    else g.ui?.hidePauseMenu?.();
  }

  closeResults() {
    document.getElementById("mp-results").classList.add("hidden");
  }

  // A line for the status chip.
  hudLine() {
    if (!this.on || !this.me) return "";
    const s = this.me;
    return s.out ? "Out: watching" : `Kills ${s.k} · Deaths ${s.d}/${this.deathLimit}`;
  }
}
