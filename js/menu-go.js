// (Round 12) One click into a world picked on the main menu. The page is
// built around one world (its seed and type are read before anything is
// built), so opening another world still reloads the page; the reload's
// address carries "go" (the mode to play it in) and the new page goes
// straight into the game instead of showing the main menu again ("Click to
// play": the browser only hands the mouse to a page after a click there). A
// room the Multiplayer screen asked for in that world goes along in this
// tab's sessionStorage (never in a link) and opens as the world starts.
// The flag is taken out of the address as soon as the page has read it, so a
// reload, the back button or a copied link shows the main menu as before.
const HOST_KEY = "ufocombat_v1_gohost";
const HOST_TTL_MS = 10 * 60 * 1000; // (a stale ask, e.g. a reload that never happened, is dropped)

// Marks `url` (a URL whose ?seed= is set) to go straight into the game, in
// `mode` ("survival" | "creative"; null: the world's own, as saved), opening
// a room in `hostMode` (a room mode, net/rules.js) when one was asked for.
export function goUrl(url, mode, hostMode = null) {
  url.searchParams.set("go", mode === "creative" || mode === "survival" ? mode : "1");
  // (A test or self-hosted signaling server goes along, as in an invite link.)
  const cur = new URLSearchParams(window.location.search);
  for (const k of ["peerServer", "noStun"]) if (cur.get(k) && !url.searchParams.has(k)) url.searchParams.set(k, cur.get(k));
  try {
    if (hostMode) sessionStorage.setItem(HOST_KEY, JSON.stringify({ seed: Number(url.searchParams.get("seed")), mode: String(hostMode), t: Date.now() }));
    else sessionStorage.removeItem(HOST_KEY);
  } catch {}
  return url;
}

// Reads and removes the flag (from the address and the tab): { mode, host }
// for this page's world `seed`, or null (the main menu, as always).
// mode: the player's mode to enter in (null: the world's own, as saved);
// host: a room mode to open, or null.
export function takeGo(seed) {
  let host = null;
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(HOST_KEY) || "null");
    sessionStorage.removeItem(HOST_KEY);
  } catch {}
  const url = new URL(window.location.href);
  const go = url.searchParams.get("go");
  if (go === null) return null;
  url.searchParams.delete("go");
  try {
    history.replaceState(history.state, "", url.toString());
  } catch {}
  if (pending && pending.seed === seed && Date.now() - pending.t < HOST_TTL_MS && typeof pending.mode === "string") host = pending.mode;
  return { mode: go === "creative" || go === "survival" ? go : null, host };
}
