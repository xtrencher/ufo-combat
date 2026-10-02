// Multiplayer screens: Host / Join (main menu and pause menu), the lobby
// (room code, invite link, players with their ping, the host's mode and
// match settings, leave), the "game ended" screen, the corner feed and the
// small status chip in the HUD.
import { normalizeRoomCode, isRoomCode, cleanNick, netErrorText, NET_ERRORS, HOST_PID } from "./session.js";
import { loadNick, saveNick, markAutoJoin, inviteUrl, showError, soloUrl } from "./boot-join.js";

const $ = (id) => document.getElementById(id);
const MODE_NAMES = { survival: "Survival", creative: "Creative", dogfight: "Dogfight" };

export class MpMenus {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.hostMode = "survival";
    this._feedEls = [];
    this._hudT = 0;
    this._build();
  }

  _build() {
    const g = this.game;
    const nickEl = $("mp-nick");
    nickEl.value = loadNick();
    nickEl.addEventListener("change", () => saveNick(nickEl.value));
    // Tabs.
    for (const tab of document.querySelectorAll(".mp-tab")) {
      tab.addEventListener("click", () => this._tab(tab.dataset.tab));
    }
    for (const card of document.querySelectorAll("[data-mpmode]")) {
      card.addEventListener("click", () => {
        this.hostMode = card.dataset.mpmode;
        for (const c of document.querySelectorAll("[data-mpmode]")) c.classList.toggle("active", c === card);
      });
    }
    $("mp-host-btn").addEventListener("click", () => this._host());
    $("mp-join-btn").addEventListener("click", () => this._join());
    $("mp-code").addEventListener("keydown", (e) => e.key === "Enter" && this._join());
    $("mp-code").addEventListener("input", (e) => {
      const el = e.target;
      const v = normalizeRoomCode(el.value);
      if (v !== el.value) el.value = v;
    });
    // Menu entries.
    $("menu-mp-btn").addEventListener("click", () => this.open());
    $("pause-mp-btn").addEventListener("click", () => this.open());
    // Lobby.
    $("mp-copy-code").addEventListener("click", () => this._copy(this.mp.net.code, $("mp-copy-code"), "Copied!"));
    $("mp-copy-link").addEventListener("click", () => this._copy(inviteUrl(this.mp.net.code), $("mp-copy-link"), "Link copied!"));
    $("mp-leave-btn").addEventListener("click", () => {
      const host = this.mp.isHost;
      if (host && this.mp.net.playerCount > 1 && !window.confirm("Close the room? Everyone else will be sent back to their own worlds.")) return;
      this.mp.leave();
      g.screens.closeAll();
      g.showMenuAfterLeave?.();
    });
    $("mp-lobby-mode").addEventListener("change", (e) => this.mp.rules?.setMode(e.target.value));
    $("mp-lobby-deaths").addEventListener("change", (e) => this.mp.dogfight?.setDeathLimit(Number(e.target.value)));
    $("mp-lobby-restart").addEventListener("click", () => this.mp.dogfight?.restart());
    // Game ended.
    $("mp-ended-solo").addEventListener("click", () => {
      g.allowUnload();
      window.location.href = soloUrl();
    });
    $("mp-ended-rejoin").addEventListener("click", () => {
      g.allowUnload();
      markAutoJoin(this.mp.net.code || "");
      window.location.reload();
    });
    // Dogfight results.
    $("mp-result-close").addEventListener("click", () => this.mp.dogfight?.closeResults());
    $("mp-result-again").addEventListener("click", () => this.mp.dogfight?.restart());
    g.screens.onOpen["mp-lobby"] = () => this.refresh();
    g.screens.onOpen["mp-screen"] = () => {
      $("mp-screen-error").classList.add("hidden");
      $("mp-screen-status").textContent = "";
      $("mp-screen-status").classList.remove("busy");
      nickEl.value = nickEl.value || loadNick();
    };
  }

  _tab(name) {
    for (const t of document.querySelectorAll(".mp-tab")) t.classList.toggle("active", t.dataset.tab === name);
    for (const p of document.querySelectorAll(".mp-tab-page")) p.classList.toggle("hidden", p.dataset.tab !== name);
    $("mp-screen-error").classList.add("hidden");
  }

  // The Multiplayer button: the lobby while in a game, else Host / Join.
  open() {
    const g = this.game;
    g.audio?.ensureStarted?.();
    g.audio?.playClick?.();
    const from = g.gameState === "start" ? "start-menu" : "pause-menu";
    if (this.mp.active) g.screens.show("mp-lobby", from);
    else g.screens.show("mp-screen", from);
  }

  async _host() {
    const status = $("mp-screen-status");
    const err = $("mp-screen-error");
    const nick = cleanNick($("mp-nick").value);
    err.classList.add("hidden");
    if (!nick) {
      status.textContent = "Pick a nickname first.";
      $("mp-nick").focus();
      return;
    }
    saveNick(nick);
    const btn = $("mp-host-btn");
    btn.disabled = true;
    status.textContent = "Opening a room...";
    status.classList.add("busy");
    try {
      const code = await this.mp.host(nick, this.hostMode);
      status.textContent = "";
      status.classList.remove("busy");
      this.game.hostStarted?.(this.hostMode);
      this.game.screens.closeAll();
      this.game.screens.show("mp-lobby", this.game.gameState === "start" ? "start-menu" : "pause-menu");
      this.game.toast?.(`Room ${code} is open: share the code (or the invite link) with your friends.`, 6);
    } catch (e) {
      status.textContent = "";
      status.classList.remove("busy");
      showError(err, e);
    } finally {
      btn.disabled = false;
    }
  }

  _join() {
    const code = normalizeRoomCode($("mp-code").value);
    const nick = cleanNick($("mp-nick").value);
    const err = $("mp-screen-error");
    err.classList.add("hidden");
    if (!nick) {
      $("mp-screen-status").textContent = "Pick a nickname first.";
      $("mp-nick").focus();
      return;
    }
    if (!isRoomCode(code)) {
      showError(err, { code: "room-not-found" });
      $("mp-code").focus();
      return;
    }
    saveNick(nick);
    markAutoJoin(code);
    this.game.flushSave?.();
    this.game.allowUnload();
    window.location.href = inviteUrl(code);
  }

  _copy(text, btn, done) {
    if (!text) return;
    const old = btn.textContent;
    const ok = () => {
      btn.textContent = done;
      setTimeout(() => (btn.textContent = old), 1500);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, () => window.prompt("Copy this:", text));
    else window.prompt("Copy this:", text);
  }

  // ---------- Lobby ----------

  refresh() {
    const mp = this.mp;
    const net = mp.net;
    const pill = $("pause-mp-state");
    if (pill) {
      pill.classList.toggle("hidden", !mp.active);
      pill.classList.toggle("on", mp.active);
      pill.textContent = mp.active ? `${net.playerCount} online` : "";
    }
    $("mp-lobby-code").textContent = net.code || "-----";
    const list = $("mp-lobby-players");
    list.innerHTML = "";
    for (const p of [...net.players.values()].sort((a, b) => a.pid - b.pid)) {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = p.color;
      const nick = document.createElement("span");
      nick.className = "nick";
      nick.textContent = p.nick + (p.pid === net.pid ? " (you)" : "");
      li.append(dot, nick);
      if (p.host) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "Host";
        li.appendChild(tag);
      }
      const ping = document.createElement("span");
      ping.className = "ping";
      ping.textContent = p.pid === net.pid ? "" : p.pid === HOST_PID || net.isHost ? `${p.ping ?? 0} ms` : "";
      li.appendChild(ping);
      if (net.isHost && p.pid !== HOST_PID) {
        const kick = document.createElement("button");
        kick.className = "btn small secondary kick";
        kick.textContent = "Remove";
        kick.addEventListener("click", () => net.kick(p.pid));
        li.appendChild(kick);
      }
      list.appendChild(li);
    }
    const hostBox = $("mp-lobby-host");
    hostBox.classList.toggle("locked", !net.isHost);
    $("mp-lobby-mode").value = mp.mode;
    $("mp-lobby-mode").disabled = !net.isHost;
    $("mp-lobby-deaths").disabled = !net.isHost;
    if (mp.dogfight) $("mp-lobby-deaths").value = String(mp.dogfight.deathLimit);
    for (const el of document.querySelectorAll(".mp-dogfight-row")) el.classList.toggle("hidden", mp.mode !== "dogfight");
    $("mp-lobby-restart").classList.toggle("hidden", !net.isHost);
    $("mp-lobby-note").textContent = !mp.active
      ? ""
      : net.isHost
        ? `You are the host: your world, your rules. Only you can change the mode and the game settings. Friends join with the code ${net.code} (Multiplayer > Join), or with the invite link.`
        : `Mode: ${MODE_NAMES[mp.mode] || mp.mode}. The host (${mp.playerName(HOST_PID)}) picks the mode and the game settings.`;
    $("mp-leave-btn").textContent = net.isHost ? "Close room" : "Leave game";
    $("mp-lobby-status").textContent = mp.active && !mp.stateLoaded ? "Receiving the world from the host..." : "";
  }

  // ---------- Game ended ----------

  showEnded(reason) {
    const g = this.game;
    const [title, help] = NET_ERRORS[reason] || NET_ERRORS.unknown;
    $("mp-ended-title").textContent = title;
    $("mp-ended-help").textContent = help;
    $("mp-ended-rejoin").classList.toggle("hidden", reason === "kicked");
    g.screens.closeAll();
    g.leftOnline?.();
    $("mp-ended").classList.remove("hidden");
    this.refresh();
  }

  // ---------- HUD ----------

  feed(text, seconds = 6) {
    const box = $("mp-feed");
    const el = document.createElement("div");
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 6) box.removeChild(box.firstChild);
    setTimeout(() => el.remove(), seconds * 1000);
  }

  update(dt) {
    this._hudT -= dt;
    if (this._hudT > 0) return;
    this._hudT = 0.5;
    const mp = this.mp;
    const hud = $("mp-hud");
    const show = mp.active && (this.game.gameState === "playing" || this.game.gameState === "inventory" || this.game.gameState === "dead");
    hud.classList.toggle("hidden", !show);
    if (!show) return;
    const net = mp.net;
    const host = net.players.get(HOST_PID);
    const lag = net.isClient ? Math.round((net.links.get(HOST_PID)?.rtt ?? 0) * 1000) : 0;
    const silent = net.isClient ? performance.now() / 1000 - (net.links.get(HOST_PID)?.lastHeard ?? 0) : 0;
    const parts = [`${MODE_NAMES[mp.mode] || mp.mode} · Room ${net.code} · ${net.playerCount} player${net.playerCount === 1 ? "" : "s"}`];
    if (net.isClient) parts.push(`${lag} ms`);
    let html = `<div class="mp-chip">${parts.join(" · ")}</div>`;
    if (net.isClient && silent > 3) html += `<div class="mp-chip warn">Connection to ${host?.nick ?? "the host"} is lagging (${Math.floor(silent)} s)...</div>`;
    else if (net.isClient && !mp.stateLoaded) html += `<div class="mp-chip">Receiving the world...</div>`;
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }
}
