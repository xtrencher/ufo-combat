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
import { EntitySync } from "./entities.js";
import { CoopSync } from "./coop.js";
import { Dogfight } from "./dogfight.js";
import { ItemSync } from "./items.js";

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
    this.entities = this.addModule(new EntitySync(this));
    this.coop = this.addModule(new CoopSync(this));
    this.dogfight = this.addModule(new Dogfight(this));
    this.items = this.addModule(new ItemSync(this));
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
      game.onStateLoaded?.();
      this.ui.refresh();
    });
    net.on("feed", (m) => typeof m.text === "string" && this.feed(m.text.slice(0, 120)));
    window.addEventListener("pagehide", () => {
      if (!net.active) return;
      if (this.isClient && this.stateLoaded && game.gameState !== "start") net.toHost({ t: "pdata", d: game.playerData() });
      net.leave();
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
    // (A guest's things, one last time, for the host to keep.)
    if (this.isClient && this.stateLoaded && this.game.gameState !== "start") this.net.toHost({ t: "pdata", d: this.game.playerData() });
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

  // This player died (main.js).
  playerDied(cause, text) {
    this.coop?.died(cause, text);
    this.dogfight?.died?.(cause);
  }

  // A line in the corner feed (joins, leaves, kills).
  feed(text, seconds = 6) {
    this.ui.feed(text, seconds);
  }

  // A short reference to a thing (a homing bolt's or missile's target) that
  // every peer can look up: "p:pid" a player, "v:nid" a shared vehicle,
  // "j:id" an enemy fighter, "u:id" a UFO, "m:id" a creature (host ids).
  refOf(obj) {
    if (!obj) return 0;
    const g = this.game;
    if (obj === g.player) return `p:${this.net.pid}`;
    if (obj.isRemote && obj.pid) return `p:${obj.pid}`;
    if (obj.net?.nid) return `v:${obj.net.nid}`;
    if (obj.isEnemyJet) return `j:${obj.netEJ ?? obj.id}`;
    if (obj.model && obj.spec && obj.size && obj.S) return `u:${obj.net?.id ?? obj.id}`;
    if (obj.kind && obj.spec && obj.pos) return `m:${obj.net?.id ?? obj.id}`;
    return 0;
  }

  resolveRef(ref) {
    if (typeof ref !== "string") return null;
    const i = ref.indexOf(":");
    const k = ref.slice(0, i);
    const id = ref.slice(i + 1);
    const g = this.game;
    const host = this.isHost;
    const e = this.entities;
    if (k === "p") {
      const pid = Number(id);
      if (pid === this.net.pid) {
        if (g.vehicles.active) return g.vehicles.active;
        return (this._meTarget ||= { get pos() { return g.player.getEyePosition(); }, get vel() { return g.player.velocity; } });
      }
      const r = this.players.get(pid);
      if (!r) return null;
      return r.vehicle || { pos: r.position, vel: r.velocity };
    }
    if (k === "v") return this.vehicles.byNid(id);
    const n = Number(id);
    if (k === "j") return host ? g.vehicles.vehicles.find((v) => v.isEnemyJet && v.id === n) : e.jetById.get(n);
    if (k === "u") return host ? g.ufos.ufos.find((u) => u.id === n) : e.ufoById.get(n);
    if (k === "m") return host ? g.mobs.mobs.find((m) => m.id === n) : e.mobById.get(n);
    return null;
  }

  playerName(pid) {
    return this.net.players.get(pid)?.nick ?? (pid === HOST_PID ? "Host" : `Player ${pid}`);
  }
}
