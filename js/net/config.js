// Multiplayer configuration, all in one place.
//
// Players connect peer-to-peer (WebRTC data channels) through PeerJS. Its
// free public signaling server (0.peerjs.com, no account or key) is only used
// to introduce the browsers to each other; after that every byte goes
// directly between them. Nothing here needs a server of our own: the game
// stays a set of static files (GitHub Pages).

// Bumped whenever the messages between peers change incompatibly: a host and
// a client with different versions refuse to play together (with a message
// saying to reload), instead of misbehaving.
export const NET_VERSION = 7;

// The PeerJS client library (loaded only when multiplayer is used, so single
// player never needs it).
export const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";

// Room codes: short, typed by hand, without look-alike characters (no 0/O,
// 1/I/L). The PeerJS id of a host is the prefix plus the code.
export const ROOM_PREFIX = "ufocombat7-";
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const MAX_PLAYERS = 8; // host included

// ICE servers: how two browsers find a way to each other.
// STUN servers tell a browser its public address (free, public, no traffic
// goes through them). That works for most home networks. Some networks
// (strict/symmetric NATs, some mobile and corporate networks) need a TURN
// server, which relays the traffic; TURN servers cost bandwidth, so none is
// configured. To add one later, fill in and uncomment the entry below (for
// example from a TURN provider or your own coturn server):
export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
  // { urls: "turn:turn.example.com:3478", username: "USERNAME", credential: "PASSWORD" },
  // { urls: "turns:turn.example.com:5349", username: "USERNAME", credential: "PASSWORD" },
];

// How often things are sent (per second) and the timeouts (seconds).
export const RATES = {
  player: 20, // a player's own position, look and vehicle
  entities: 15, // the host's UFOs, creatures and enemy jets
  heartbeat: 1, // ping (and the clock sync)
  timeSync: 0.5, // time of day
};
export const TIMEOUTS = {
  signaling: 12, // reaching the signaling server
  connect: 20, // opening the data channel to the host
  welcome: 15, // the host answering the hello
  silent: 12, // a peer that sent nothing for this long is gone
};

// Interpolation: remote things are drawn this far in the past (seconds),
// between two received states.
export const INTERP_DELAY = 0.1;
export const MAX_EXTRAPOLATE = 0.25;

// PeerJS options. The public PeerJS cloud by default; `?peerServer=host:port/path`
// (or `https://host:port/path`) points the game at another PeerJS server, e.g. a
// local one for the automated tests or a self-hosted one.
export function peerOptions() {
  const params = new URLSearchParams(window.location.search);
  const custom = params.get("peerServer");
  const opts = { debug: 0, config: { iceServers: ICE_SERVERS } };
  if (custom) {
    const m = /^(?:(https?):\/\/)?([^:/]+)(?::(\d+))?(\/.*)?$/.exec(custom);
    if (m) {
      opts.host = m[2];
      opts.secure = m[1] === "https";
      opts.port = Number(m[3]) || (opts.secure ? 443 : 80);
      opts.path = m[4] || "/";
    }
    // A local test server: no STUN (there is no internet to reach it anyway).
    if (params.get("noStun") === "1") opts.config = { iceServers: [] };
  }
  return opts;
}
