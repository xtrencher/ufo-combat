// The multiplayer session: hosting a room, joining one, and the messages
// between the players.
//
// Star topology: every client connects to the host only; the host relays
// what the other clients need. Each client has two data channels to the
// host:
//   rel:  reliable and ordered (events, block edits, the join state);
//   fast: unordered (player and vehicle states, entity snapshots), so a late
//         packet never holds back a newer one.
// Messages are plain objects with a type `t`, sent as JSON strings; big ones
// (the join state) are cut into parts and put together on arrival.
//
// Game code talks to the session through:
//   net.on(type, fn(msg, fromPid))      handle a message type
//   net.send(pid, msg, { fast })         to one peer (the host is pid 1)
//   net.broadcast(msg, { fast, except }) host: to every client
//   net.toHost(msg, { fast })            client: to the host
//   net.registerSync(name, { save(pidJoining), load(data) })
//                                        a piece of the state a joining player gets
// and the hooks onPlayerJoin / onPlayerLeave / onClosed.
import { NET_VERSION, PEERJS_URL, ROOM_PREFIX, ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET, MAX_PLAYERS, TIMEOUTS, RATES, peerOptions } from "./config.js";

export const HOST_PID = 1;
const PART_SIZE = 30000; // characters per part of a big message
const NICK_MAX = 16;

export class NetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// What went wrong, for a player: [title, what to try].
export const NET_ERRORS = {
  lib: ["The multiplayer library couldn't be loaded", "It comes from cdn.jsdelivr.net: check the internet connection (and that no blocker stops it), then try again."],
  signaling: ["Can't reach the matchmaking server", "Multiplayer uses the free PeerJS server (0.peerjs.com) to introduce the players. It didn't answer: check the internet connection, a firewall or ad blocker may block it, or the server is busy. Try again in a minute."],
  "room-not-found": ["Room not found", "No game is open with that code. Check the code (letters and digits, no 0/O or 1/I), and that the host is still in the game with the room open."],
  "connect-failed": ["Couldn't connect to the host", "The players' networks didn't let a direct connection through (strict NAT, a firewall, a VPN, some mobile or school/office networks). Try another network (a phone hotspot often works), or have the other player host. A TURN relay server would fix this (see README)."],
  timeout: ["The host didn't answer", "The connection opened but the host's game didn't reply in time. The host may be loading, or their tab is frozen: try again."],
  version: ["Different game versions", "You and the host have different versions of the game. Both reload the page (Ctrl+Shift+R) to get the latest one."],
  full: ["The room is full", `A game holds ${MAX_PLAYERS} players at most.`],
  kicked: ["You were removed from the game", "The host removed you from the room."],
  "host-left": ["The host left the game", "The host closed the room or left. You can go back to your own world, or join again when they host a new room."],
  "host-lost": ["Lost the connection to the host", "The host stopped answering (their game closed, crashed, or the network dropped). You can go back to your own world, or join again."],
  "id-taken": ["Couldn't open a room", "Try again."],
  unknown: ["Multiplayer error", "Something went wrong with the connection. Try again."],
};

export function netErrorText(err) {
  const code = err?.code && NET_ERRORS[err.code] ? err.code : "unknown";
  const [title, help] = NET_ERRORS[code];
  return { code, title, help, detail: code === "unknown" ? String(err?.message || err || "") : "" };
}

// ---------- PeerJS ----------

let peerLibPromise = null;
export function loadPeerJS() {
  if (window.peerjs?.Peer) return Promise.resolve(window.peerjs.Peer);
  if (peerLibPromise) return peerLibPromise;
  peerLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PEERJS_URL;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => (window.peerjs?.Peer ? resolve(window.peerjs.Peer) : reject(new NetError("lib", "PeerJS did not load")));
    s.onerror = () => {
      peerLibPromise = null;
      s.remove();
      reject(new NetError("lib", "PeerJS did not load"));
    };
    document.head.appendChild(s);
  });
  return peerLibPromise;
}

// ---------- Room codes and nicknames ----------

export function randomRoomCode() {
  let s = "";
  const a = ROOM_CODE_ALPHABET;
  const rnd = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += a[rnd[i] % a.length];
  return s;
}

// What a player typed (any case, spaces, dashes, look-alikes) as a code.
export function normalizeRoomCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH + 4);
}

export function isRoomCode(code) {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

export function cleanNick(raw) {
  const s = String(raw || "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NICK_MAX);
  return s;
}

// Player colours (nameplates, scoreboard), by player number.
export const PLAYER_COLORS = ["#4fd0ff", "#ff9a3c", "#7dff6a", "#ff5ad0", "#ffe04a", "#b08cff", "#ff5a5a", "#4affc0"];
export function playerColor(pid) {
  return PLAYER_COLORS[(pid - 1) % PLAYER_COLORS.length];
}

const now = () => performance.now() / 1000;

// ---------- A connection to one peer ----------

class Link {
  constructor(session, pid, rel) {
    this.session = session;
    this.pid = pid;
    this.rel = rel;
    this.fast = null;
    this.lastHeard = now();
    this.rtt = 0.1;
    this.parts = new Map(); // id -> { n, got, list }
    this.closed = false;
  }

  send(msg, fast = false) {
    const ch = fast && this.fast && this.fast.open ? this.fast : this.rel;
    if (!ch || !ch.open || this.closed) return false;
    const s = JSON.stringify(msg);
    try {
      if (s.length <= PART_SIZE || (fast && ch === this.fast)) {
        if (s.length > PART_SIZE) return false; // (fast messages are kept small; a huge one is dropped)
        ch.send(s);
        this.session.stats.sent += s.length;
        return true;
      }
      // Too big for one message: parts on the reliable channel.
      const id = (this.session._partId = (this.session._partId + 1) % 1e9);
      const n = Math.ceil(s.length / PART_SIZE);
      for (let i = 0; i < n; i++) this.rel.send(JSON.stringify({ t: "_part", id, i, n, d: s.slice(i * PART_SIZE, (i + 1) * PART_SIZE) }));
      this.session.stats.sent += s.length;
      return true;
    } catch (err) {
      console.warn("UFO COMBAT net: send failed", err);
      return false;
    }
  }

  // A raw string arrived: the message, or null while parts are still missing.
  receive(raw) {
    this.lastHeard = now();
    this.session.stats.received += raw.length || 0;
    let msg;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
    if (!msg || typeof msg.t !== "string") return null;
    if (msg.t !== "_part") return msg;
    let p = this.parts.get(msg.id);
    if (!p) {
      p = { n: msg.n, got: 0, list: new Array(msg.n) };
      this.parts.set(msg.id, p);
    }
    if (p.list[msg.i] === undefined) {
      p.list[msg.i] = msg.d;
      p.got++;
    }
    this.session.onProgress?.(this.pid, p.got / p.n);
    if (p.got < p.n) return null;
    this.parts.delete(msg.id);
    try {
      return JSON.parse(p.list.join(""));
    } catch {
      return null;
    }
  }

  close() {
    this.closed = true;
    try {
      this.rel?.close();
    } catch {}
    try {
      this.fast?.close();
    } catch {}
  }
}

// ---------- The session ----------

export class NetSession {
  constructor() {
    this.role = "offline"; // "offline" | "host" | "client"
    this.peer = null;
    this.code = null;
    this.pid = 0; // our player number (host: 1)
    this.nick = "";
    this.players = new Map(); // pid -> { pid, nick, color, host, ping }
    this.links = new Map(); // pid -> Link (host: one per client; client: pid 1 = the host)
    this.handlers = new Map(); // type -> [fn]
    this.syncs = new Map(); // name -> { save, load }
    this.stats = { sent: 0, received: 0 };
    this._partId = 0;
    this._nextPid = 2;
    this.clockOffset = 0; // client: host time - local time (seconds)
    this._bestRtt = Infinity;
    this.hostInfo = null; // client: what the welcome said
    this.closedReason = null;
    // Hooks.
    this.onPlayerJoin = null; // (player) => void
    this.onPlayerLeave = null; // (player, reason) => void
    this.onClosed = null; // (reason code) => void: the session ended (not by us)
    this.onPlayersChanged = null; // () => void
    this.onProgress = null; // (pid, 0-1) big message arriving
    this.onStatus = null; // (text) => void: connection progress
    this.acceptJoin = null; // host: (hello) => null | refusal code
    this.welcomeExtra = null; // host: (pid) => object merged into the welcome
    this._timer = null;
  }

  get active() {
    return this.role !== "offline";
  }
  get isHost() {
    return this.role === "host";
  }
  get isClient() {
    return this.role === "client";
  }
  get playerCount() {
    return this.players.size;
  }

  // Host time (seconds): the clock every timestamp in the game's messages uses.
  get time() {
    return now() + (this.role === "client" ? this.clockOffset : 0);
  }

  // ---------- Messages ----------

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => {
      const list = this.handlers.get(type);
      const i = list ? list.indexOf(fn) : -1;
      if (i >= 0) list.splice(i, 1);
    };
  }

  registerSync(name, sync) {
    this.syncs.set(name, sync);
  }

  send(pid, msg, { fast = false } = {}) {
    const link = this.links.get(pid);
    return link ? link.send(msg, fast) : false;
  }

  toHost(msg, opts) {
    if (this.role !== "client") return false;
    return this.send(HOST_PID, msg, opts);
  }

  // Host: to every client (or every client but `except`).
  broadcast(msg, { fast = false, except = 0 } = {}) {
    if (this.role !== "host") return;
    for (const [pid, link] of this.links) if (pid !== except && link.ready) link.send(msg, fast);
  }

  // Either side: to everyone else in the game (a client goes through the
  // host, which relays it: see "_relay").
  toAll(msg, { fast = false } = {}) {
    if (this.role === "host") this.broadcast(msg, { fast });
    else if (this.role === "client") this.toHost({ t: "_relay", m: msg, f: fast ? 1 : 0 }, { fast });
  }

  _dispatch(msg, from) {
    const list = this.handlers.get(msg.t);
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        fn(msg, from);
      } catch (err) {
        console.error(`UFO COMBAT net: error handling "${msg.t}"`, err);
      }
    }
  }

  // ---------- Hosting ----------

  async host({ nick, code = null }) {
    if (this.active) throw new NetError("unknown", "Already in a multiplayer game");
    const Peer = await loadPeerJS();
    this.nick = cleanNick(nick) || "Host";
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const tryCode = attempt === 0 && code ? code : randomRoomCode();
      try {
        this.peer = await this._openPeer(Peer, ROOM_PREFIX + tryCode);
        this.code = tryCode;
        break;
      } catch (err) {
        lastErr = err;
        if (err.code !== "id-taken") throw err;
      }
    }
    if (!this.peer) throw lastErr || new NetError("id-taken", "No free room code");
    this.role = "host";
    this.pid = 1;
    this.players.clear();
    this.players.set(1, { pid: 1, nick: this.nick, color: playerColor(1), host: true, ping: 0 });
    this.peer.on("connection", (conn) => this._hostIncoming(conn));
    this.peer.on("disconnected", () => {
      // Lost the signaling server: games in progress go on; reconnect so new
      // players can still find the room.
      if (this.role === "host" && this.peer && !this.peer.destroyed) setTimeout(() => this.peer && !this.peer.destroyed && this.peer.disconnected && this.peer.reconnect(), 2000);
    });
    this.peer.on("error", (err) => {
      if (this.role === "host") console.warn("UFO COMBAT net (host):", err?.type, err?.message);
    });
    this._startTimer();
    this.onPlayersChanged?.();
    return this.code;
  }

  _openPeer(Peer, id) {
    return new Promise((resolve, reject) => {
      let done = false;
      const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
      const fail = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          peer.destroy();
        } catch {}
        reject(err);
      };
      const timer = setTimeout(() => fail(new NetError("signaling", "Signaling server timeout")), TIMEOUTS.signaling * 1000);
      peer.on("open", () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(peer);
      });
      peer.on("error", (err) => {
        const type = err?.type;
        if (type === "unavailable-id") fail(new NetError("id-taken", "Room id taken"));
        else if (type === "browser-incompatible") fail(new NetError("connect-failed", "WebRTC not supported"));
        else if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed" || type === "ssl-unavailable") fail(new NetError("signaling", err?.message || type));
        else if (!done) fail(new NetError("unknown", err?.message || String(type)));
      });
    });
  }

  _hostIncoming(conn) {
    const meta = conn.metadata || {};
    if (meta.ch === "fast") {
      // The second channel of a client that already said hello.
      const link = this.links.get(meta.pid);
      if (!link || link.token !== meta.token) {
        conn.close();
        return;
      }
      conn.on("open", () => {
        link.fast = conn;
      });
      conn.on("data", (raw) => this._onData(link, raw));
      conn.on("close", () => {
        if (link.fast === conn) link.fast = null;
      });
      return;
    }
    let link = null;
    conn.on("data", (raw) => {
      if (link) {
        this._onData(link, raw);
        return;
      }
      // The first message must be the hello.
      let hello;
      try {
        hello = JSON.parse(raw);
      } catch {
        conn.close();
        return;
      }
      if (!hello || hello.t !== "_hello") {
        conn.close();
        return;
      }
      const refuse = (reason) => {
        try {
          conn.send(JSON.stringify({ t: "_refuse", reason }));
        } catch {}
        setTimeout(() => conn.close(), 500);
      };
      if (hello.v !== NET_VERSION) return refuse("version");
      if (this.players.size >= MAX_PLAYERS) return refuse("full");
      const why = this.acceptJoin?.(hello);
      if (why) return refuse(why);
      const pid = this._nextPid++;
      link = new Link(this, pid, conn);
      link.token = Math.random().toString(36).slice(2);
      link.peerId = conn.peer;
      this.links.set(pid, link);
      const nick = this._uniqueNick(cleanNick(hello.nick) || `Player ${pid}`);
      const player = { pid, nick, color: playerColor(pid), host: false, ping: 0 };
      this.players.set(pid, player);
      link.send({ t: "_welcome", pid, token: link.token, code: this.code, players: [...this.players.values()], ...(this.welcomeExtra?.(pid) || {}) });
      // Not "ready" (no game traffic) until it asks for the state.
      link.ready = false;
      this.broadcast({ t: "_players", players: [...this.players.values()] }, { except: pid });
      this.onPlayerJoin?.(player);
      this.onPlayersChanged?.();
    });
    conn.on("close", () => {
      if (link && this.links.get(link.pid) === link) this._dropClient(link.pid, "left");
    });
    conn.on("error", (err) => console.warn("UFO COMBAT net: connection error", err?.type, err?.message));
  }

  _uniqueNick(nick) {
    const taken = new Set([...this.players.values()].map((p) => p.nick.toLowerCase()));
    if (!taken.has(nick.toLowerCase())) return nick;
    for (let i = 2; ; i++) {
      const n = `${nick.slice(0, NICK_MAX - 2)}${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
  }

  // Host: a client is gone (left, timed out, or kicked).
  _dropClient(pid, reason = "left") {
    const link = this.links.get(pid);
    if (!link) return;
    this.links.delete(pid);
    link.close();
    const player = this.players.get(pid);
    this.players.delete(pid);
    this.broadcast({ t: "_players", players: [...this.players.values()], left: pid, reason });
    if (player) this.onPlayerLeave?.(player, reason);
    this.onPlayersChanged?.();
  }

  kick(pid) {
    if (this.role !== "host" || pid === HOST_PID) return;
    this.send(pid, { t: "_bye", reason: "kicked" });
    setTimeout(() => this._dropClient(pid, "kicked"), 300);
  }

  // Host: the joining client asked for the game state (after building its world).
  _sendState(link) {
    const state = {};
    for (const [name, sync] of this.syncs) {
      try {
        state[name] = sync.save ? sync.save(link.pid) : null;
      } catch (err) {
        console.error(`UFO COMBAT net: saving "${name}" for a joining player failed`, err);
      }
    }
    link.send({ t: "_state", state });
    link.ready = true;
  }

  // ---------- Joining ----------

  async join(code, { nick }) {
    if (this.active) throw new NetError("unknown", "Already in a multiplayer game");
    this.onStatus?.("Loading the multiplayer library...");
    const Peer = await loadPeerJS();
    this.nick = cleanNick(nick) || "Player";
    this.onStatus?.("Reaching the matchmaking server...");
    this.peer = await this._openPeer(Peer, null);
    this.onStatus?.(`Looking for room ${code}...`);
    try {
      const welcome = await this._connectToHost(code);
      this.role = "client";
      this.code = code;
      this.pid = welcome.pid;
      this.hostInfo = welcome;
      this._setPlayers(welcome.players);
      this.peer.on("disconnected", () => {
        // (The signaling server is not needed any more once connected.)
      });
      this._startTimer();
      return welcome;
    } catch (err) {
      this._teardown();
      throw err;
    }
  }

  _connectToHost(code) {
    const hostId = ROOM_PREFIX + code;
    return new Promise((resolve, reject) => {
      let done = false;
      let opened = false;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) {
          try {
            conn.close();
          } catch {}
          reject(err);
        } else resolve(value);
      };
      const onPeerError = (err) => {
        if (err?.type === "peer-unavailable") finish(new NetError("room-not-found", "Room not found"));
        else if (err?.type === "network" || err?.type === "server-error" || err?.type === "socket-error") finish(new NetError("signaling", err?.message));
        else if (!opened) finish(new NetError("connect-failed", err?.message || err?.type));
      };
      this.peer.on("error", onPeerError);
      const conn = this.peer.connect(hostId, { reliable: true, serialization: "raw", metadata: { ch: "rel" } });
      if (!conn) {
        finish(new NetError("signaling", "Could not start the connection"));
        return;
      }
      let timer = setTimeout(() => finish(new NetError(opened ? "timeout" : "connect-failed", "Connection timeout")), TIMEOUTS.connect * 1000);
      const link = new Link(this, HOST_PID, conn);
      conn.on("open", () => {
        opened = true;
        this.onStatus?.(`Connected to room ${code}, saying hello...`);
        clearTimeout(timer);
        timer = setTimeout(() => finish(new NetError("timeout", "No welcome")), TIMEOUTS.welcome * 1000);
        conn.send(JSON.stringify({ t: "_hello", v: NET_VERSION, nick: this.nick }));
      });
      conn.on("data", (raw) => {
        if (!done) {
          const msg = link.receive(raw);
          if (!msg) return;
          if (msg.t === "_refuse") return finish(new NetError(msg.reason === "version" || msg.reason === "full" ? msg.reason : "unknown", `Refused: ${msg.reason}`));
          if (msg.t === "_welcome") {
            this.links.set(HOST_PID, link);
            link.ready = true;
            // The second, unordered channel for the steady stream of states.
            const fast = this.peer.connect(hostId, { reliable: false, serialization: "raw", metadata: { ch: "fast", pid: msg.pid, token: msg.token } });
            if (fast) {
              fast.on("open", () => (link.fast = fast));
              fast.on("data", (r) => this._onData(link, r));
              fast.on("close", () => {
                if (link.fast === fast) link.fast = null;
              });
            }
            finish(null, msg);
          }
          return;
        }
        this._onData(link, raw);
      });
      conn.on("close", () => {
        if (!done) finish(new NetError(opened ? "host-lost" : "connect-failed", "Closed"));
        else if (this.role === "client" && this.links.get(HOST_PID) === link) this._lostHost("host-lost");
      });
      conn.on("error", (err) => {
        if (!done) finish(new NetError("connect-failed", err?.message || err?.type));
      });
    });
  }

  // Client: ready for the game state (the world is built).
  requestState() {
    this.toHost({ t: "_ready" });
  }

  _setPlayers(list) {
    this.players.clear();
    for (const p of list || []) this.players.set(p.pid, { ...p });
    this.onPlayersChanged?.();
  }

  _lostHost(reason) {
    if (this.role !== "client") return;
    this.closedReason = reason;
    this._teardown();
    this.onClosed?.(reason);
  }

  // ---------- Incoming ----------

  _onData(link, raw) {
    const msg = link.receive(raw);
    if (!msg) return;
    switch (msg.t) {
      case "_ping":
        link.send({ t: "_pong", ts: msg.ts, now: now() });
        return;
      case "_pong": {
        const rtt = Math.max(0, now() - msg.ts);
        link.rtt = link.rtt * 0.7 + rtt * 0.3;
        if (this.role === "client") {
          // The host's clock, from the least-delayed samples (a delayed one overestimates).
          const offset = msg.now + rtt / 2 - now();
          if (rtt <= this._bestRtt * 1.3 || !this._clockSet) {
            this._bestRtt = Math.min(this._bestRtt * 1.05 + 0.002, rtt);
            this.clockOffset = this._clockSet ? this.clockOffset * 0.8 + offset * 0.2 : offset;
            this._clockSet = true;
          }
        } else {
          const p = this.players.get(link.pid);
          if (p) p.ping = Math.round(link.rtt * 1000);
        }
        return;
      }
      case "_bye":
        if (this.role === "client") this._lostHost(msg.reason === "kicked" ? "kicked" : "host-left");
        else this._dropClient(link.pid, "left");
        return;
      case "_players":
        if (this.role === "client") {
          const left = msg.left ? this.players.get(msg.left) : null;
          const before = new Set(this.players.keys());
          this._setPlayers(msg.players);
          for (const p of this.players.values()) if (!before.has(p.pid) && p.pid !== this.pid) this.onPlayerJoin?.(p);
          if (left) this.onPlayerLeave?.(left, msg.reason || "left");
        }
        return;
      case "_ready":
        if (this.role === "host") this._sendState(link);
        return;
      case "_state":
        if (this.role === "client") {
          for (const [name, data] of Object.entries(msg.state || {})) {
            const sync = this.syncs.get(name);
            if (!sync?.load) continue;
            try {
              sync.load(data);
            } catch (err) {
              console.error(`UFO COMBAT net: loading "${name}" from the host failed`, err);
            }
          }
          this._dispatch({ t: "_stateLoaded" }, HOST_PID);
        }
        return;
      case "_relay":
        // Host: a client's message for everyone: handled here too, and passed on.
        if (this.role === "host" && msg.m && typeof msg.m.t === "string" && !msg.m.t.startsWith("_")) {
          msg.m._from = link.pid;
          this._dispatch(msg.m, link.pid);
          const fast = !!msg.f;
          for (const [pid, l] of this.links) if (pid !== link.pid && l.ready) l.send(msg.m, fast);
        }
        return;
      default:
        if (msg.t.startsWith("_")) return;
        // (Relayed messages carry their original sender.)
        this._dispatch(msg, this.role === "client" && msg._from ? msg._from : link.pid);
    }
  }

  // ---------- Heartbeat ----------

  _startTimer() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this._tick(), 1000 / RATES.heartbeat);
  }

  _tick() {
    const t = now();
    this._lastTick = t;
    for (const [pid, link] of this.links) {
      link.send({ t: "_ping", ts: t });
      if (t - link.lastHeard > 12) {
        if (this.role === "host") this._dropClient(pid, "timeout");
        else this._lostHost("host-lost");
      }
    }
  }

  // Called by the game every step (also from the worker clock while the tab
  // is hidden, where timers can be throttled hard): the heartbeat runs at
  // least once a second either way.
  pump() {
    const t = now();
    if (this.active && t - (this._lastTick ?? 0) >= 1 / RATES.heartbeat) this._tick();
  }

  // ---------- Leaving ----------

  // Leaves (client) or closes the room (host), telling the others.
  leave() {
    if (!this.active) return;
    if (this.role === "host") this.broadcast({ t: "_bye", reason: "host-left" });
    else this.toHost({ t: "_bye" });
    const role = this.role;
    // (Give the goodbye a moment to leave before the channels close.)
    this.role = "offline";
    setTimeout(() => this._teardown(), role === "host" ? 400 : 200);
  }

  _teardown() {
    clearInterval(this._timer);
    this._timer = null;
    for (const link of this.links.values()) link.close();
    this.links.clear();
    try {
      this.peer?.destroy();
    } catch {}
    this.peer = null;
    this.role = "offline";
    this.players.clear();
  }
}
