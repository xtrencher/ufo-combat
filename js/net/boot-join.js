// Joining a game from an invite link or the Join screen: the page is opened
// with ?join=CODE and, before the world is built, asks for a nickname (or
// takes the one just typed on the Join screen), connects to the host and
// waits for its welcome, which carries the world's seed. The game then
// builds the host's world straight away (no second reload). Errors say what
// went wrong and what to try, with "Try again" and "Play single player".
import { netErrorText, normalizeRoomCode, isRoomCode, cleanNick } from "./session.js";

const NICK_KEY = "ufocombat_v1_nick";
const AUTOJOIN_KEY = "ufocombat_v1_autojoin";

export function loadNick() {
  try {
    return cleanNick(localStorage.getItem(NICK_KEY) || "");
  } catch {
    return "";
  }
}

export function saveNick(nick) {
  try {
    localStorage.setItem(NICK_KEY, cleanNick(nick));
  } catch {}
}

// The Join screen already asked for the nickname: the page it opens joins at
// once instead of asking again.
export function markAutoJoin(code) {
  try {
    sessionStorage.setItem(AUTOJOIN_KEY, code);
  } catch {}
}

// The page's own address without the multiplayer parameters (single player).
export function soloUrl() {
  const url = new URL(window.location.href);
  for (const k of ["join", "seed"]) url.searchParams.delete(k);
  return url.toString();
}

export function inviteUrl(code) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  // (A test or self-hosted signaling server travels with the link.)
  const cur = new URLSearchParams(window.location.search);
  for (const k of ["peerServer", "noStun"]) if (cur.get(k)) url.searchParams.set(k, cur.get(k));
  url.searchParams.set("join", code);
  return url.toString();
}

export function showError(el, err) {
  const e = netErrorText(err);
  el.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = e.title;
  const p = document.createElement("p");
  p.textContent = e.help;
  el.append(b, p);
  if (e.detail) {
    const pre = document.createElement("pre");
    pre.textContent = e.detail;
    el.appendChild(pre);
  }
  el.classList.remove("hidden");
}

// Resolves with the host's welcome once connected; until then the player can
// retry as often as they like (or leave for single player).
export function bootJoin(net, rawCode) {
  const $ = (id) => document.getElementById(id);
  const overlay = $("mp-join-boot");
  const codeEl = $("mp-boot-code");
  const nickEl = $("mp-boot-nick");
  const status = $("mp-boot-status");
  const errEl = $("mp-boot-error");
  const joinBtn = $("mp-boot-join");
  $("mp-boot-solo").href = soloUrl();
  document.getElementById("boot")?.classList.add("hidden");
  overlay.classList.remove("hidden");
  codeEl.value = normalizeRoomCode(rawCode);
  nickEl.value = loadNick();
  let auto = false;
  try {
    auto = sessionStorage.getItem(AUTOJOIN_KEY) === codeEl.value && !!nickEl.value;
    sessionStorage.removeItem(AUTOJOIN_KEY);
  } catch {}
  return new Promise((resolve) => {
    let busy = false;
    const setBusy = (on, text = "") => {
      busy = on;
      joinBtn.disabled = on;
      codeEl.disabled = on;
      nickEl.disabled = on;
      status.textContent = text;
      status.classList.toggle("busy", on);
    };
    net.onStatus = (text) => {
      if (busy) status.textContent = text;
    };
    const attempt = async () => {
      if (busy) return;
      const code = normalizeRoomCode(codeEl.value);
      codeEl.value = code;
      const nick = cleanNick(nickEl.value);
      errEl.classList.add("hidden");
      if (!isRoomCode(code)) {
        showError(errEl, { code: "room-not-found" });
        codeEl.focus();
        return;
      }
      if (!nick) {
        status.textContent = "Pick a nickname first.";
        nickEl.focus();
        return;
      }
      saveNick(nick);
      // (The address shows the code actually joined.)
      const url = new URL(window.location.href);
      url.searchParams.set("join", code);
      url.searchParams.delete("seed");
      history.replaceState(null, "", url.toString());
      setBusy(true, `Connecting to room ${code}...`);
      try {
        const welcome = await net.join(code, { nick });
        setBusy(false, "");
        status.textContent = `Joined ${welcome.hostNick || "the host"}'s game. Loading the world...`;
        net.onStatus = null;
        resolve(welcome);
      } catch (err) {
        setBusy(false, "");
        joinBtn.textContent = "Try again";
        showError(errEl, err);
      }
    };
    joinBtn.addEventListener("click", attempt);
    for (const el of [codeEl, nickEl]) el.addEventListener("keydown", (e) => e.key === "Enter" && attempt());
    if (auto) attempt();
    else (nickEl.value ? joinBtn : nickEl).focus();
  });
}

// The loading screen after the welcome: the overlay goes once the game is up.
export function hideBootJoin() {
  document.getElementById("mp-join-boot")?.classList.add("hidden");
}
