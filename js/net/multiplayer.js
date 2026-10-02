// Multiplayer: ties the session (session.js) to the game.
//
// The game (main.js) hands over its systems as `game`; each part of the
// synchronisation is its own module with the same small interface
// (start(), update(dt), playerJoined(p), playerLeft(p), stop()):
//   players.js   remote players: states, avatars, nameplates
//   vehicles.js  vehicles: owners, puppets, claims
//   world.js     block edits, the join transfer of the world
//   fx.js        explosions, shots, projectiles seen by everyone
//   entities.js  the host's UFOs, creatures and enemy jets on the clients,
//                AI targets for every player, hit claims
//   rules.js     mode, rule settings, time of day, missions, deaths, loot
//   dogfight.js  the Dogfight mode
//   ui.js        menus, lobby, HUD
// A mod can add its own module the same way (mp.addModule(m)), and its own
// messages with net.on(type, fn) / net.toAll(msg).
import { HOST_PID } from "./session.js";
import { BackgroundClock } from "./bgclock.js";
import { MpMenus } from "./ui.js";
import { soloUrl, hideBootJoin } from "./boot-join.js";
import { PlayerSync } from "./players.js";
import { VehicleSync } from "./vehicles.js";
import { WorldSync } from "./world.js";
import { FxSync } from "./fx.js";
import { RulesSync } from "./rules.js";

export class Multiplayer {
  constructor(net, game) {
    this.net = net;
    this.game = game;
    this.modules = [];
    this.mode = game.GUEST ? game.joinWelcome.mode || "survival" : "survival"; // survival | creative | dogfight
    this.stateLoaded = !game.GUEST; // a guest: the host's state has arrived
    this.ended = null; // why the session ended (shown on screen)
    this.bg = new BackgroundClock(() => game.backgroundStep());
    this.ui = new MpMenus(this);
    this.players = this.addModule(new PlayerSync(this));
    this.vehicles = this.addModule(new VehicleSync(this));
    this.world = this.addModule(new WorldSync(this));
    this.fx = this.addModule(new FxSync(this));
    this.rules = this.addModule(new RulesSync(this));
    net.onClosed = (reason) => this._ended(reason);
    net.onPlayerJoin = (p) => {
      for (const m of this.modules) m.playerJoined?.(p);
      if (p.pid !== net.pid) this.feed(`${p.nick} joined the game`);
    };
    net.onPlayerLeave = (p, reason) => {
      for (const m of this.modules) m.playerLeft?.(p, reason);
      this.feed(`${p.nick} ${reason === "kicked" ? "was removed" : reason === "timeout" ? "lost the connection" : "left the game"}`);
    };
    net.onPlayersChanged = () => this.ui.refresh();
    net.welcomeExtra = () => ({ seed: game.SEED, hostNick: net.nick, mode: this.mode });
    net.on("_stateLoaded", () => {
      this.stateLoaded = true;
      for (const m of this.modules) m.stateLoaded?.();
      this.ui.refresh();
    });
    window.addEventListener("pagehide", () => {
      if (net.active) net.leave();
    });
  }

  get active() {
    return this.net.active;
  }
  get isHost() {
    return this.net.isHost;
  }
  get isClient() {
    return this.net.isClient;
  }
  get pid() {
    return this.net.pid;
  }

  addModule(m) {
    this.modules.push(m);
    if (this.active) m.start?.();
    return m;
  }

  // ---------- Starting ----------

  // Host: opens a room in the current world.
  async host(nick, mode) {
    this.mode = mode || this.mode;
    const code = await this.net.host({ nick });
    this._started();
    return code;
  }

  // Guest: the world is built; ask for the game state.
  startGuest() {
    this._started();
    this.net.requestState();
  }

  _started() {
    this.bg.start();
    for (const m of this.modules) m.start?.();
    this.ui.refresh();
    hideBootJoin();
  }

  // ---------- Leaving ----------

  // Leave the game (guest) or close the room (host).
  leave() {
    const wasGuest = this.game.GUEST;
    this.net.leave();
    this.bg.stop();
    for (const m of this.modules) m.stop?.();
    this.ui.refresh();
    if (wasGuest) {
      this.game.allowUnload();
      window.location.href = soloUrl();
    }
  }

  _ended(reason) {
    this.ended = reason;
    this.bg.stop();
    for (const m of this.modules) m.stop?.();
    this.ui.showEnded(reason);
  }

  // ---------- Per frame ----------

  update(dt) {
    if (!this.active) return;
    this.net.pump();
    for (const m of this.modules) m.update?.(dt);
    this.ui.update(dt);
  }

  // A line in the corner feed (joins, leaves, kills).
  feed(text, seconds = 6) {
    this.ui.feed(text, seconds);
  }

  playerName(pid) {
    return this.net.players.get(pid)?.nick ?? (pid === HOST_PID ? "Host" : `Player ${pid}`);
  }
}
