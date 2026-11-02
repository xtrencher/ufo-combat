// (Round 16) The mission board's screens: the board itself (Esc > Missions,
// or M while playing) and the tracker's lines for a board mission (top
// right). main.js calls these; the board is js/mission-board.js.
import { itemInfo } from "./items.js";
import { CATEGORIES, TIERS, VEHICLE_NAMES } from "./mission-catalog.js";

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const clock = (s) => {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const stars = (n) => "★".repeat(n) + "☆".repeat(3 - n);
const rewardText = (r) => r.map(([id, n]) => `${n > 1 ? `${n} x ` : ""}${itemInfo(id)?.name ?? "item"}`).join(", ");
const VEHICLE_LABEL = { tank: "a tank", jet: "a fighter jet", heli: "a helicopter", aa: "an AA vehicle", ufo: "an alien ship to take", b2: "the B-2 bomber" };

let styled = false;
function style() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
  #missions-list .mb-head { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; margin-bottom: 8px; }
  #missions-list .mb-rank { color: #ffd45a; font-weight: 700; }
  #missions-list .mb-sub { opacity: 0.75; font-size: 12px; }
  #missions-list .mb-box { padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; background: rgba(255,212,90,0.12); border-left: 3px solid #ffd45a; }
  #missions-list .mb-box.fail { background: rgba(255,90,90,0.12); border-left-color: #ff6a6a; }
  #missions-list .mb-box.win { background: rgba(127,227,154,0.12); border-left-color: #7fe39a; }
  #missions-list .mb-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 8px; }
  #missions-list .mb-tab { padding: 4px 9px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.05); color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
  #missions-list .mb-tab.on { background: rgba(255,212,90,0.2); border-color: #ffd45a; color: #ffd45a; }
  #missions-list .mb-blurb { font-size: 12px; opacity: 0.75; margin-bottom: 6px; }
  #missions-list .mb-card { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 8px 10px; border-radius: 6px; margin-bottom: 6px; background: rgba(255,255,255,0.04); }
  #missions-list .mb-card.locked { opacity: 0.5; }
  #missions-list .mb-card.current { background: rgba(255,212,90,0.12); border-left: 3px solid #ffd45a; }
  #missions-list .mb-card > .mb-go { grid-column: 2; grid-row: 1 / span 4; align-self: center; }
  #missions-list .mb-title { font-weight: 700; }
  #missions-list .mb-tier { color: #ffd45a; font-size: 11.5px; margin-left: 6px; white-space: nowrap; }
  #missions-list .mb-done { color: #7fe39a; font-size: 11.5px; margin-left: 6px; }
  #missions-list .mb-brief { font-size: 12px; opacity: 0.9; }
  #missions-list .mb-meta { font-size: 11.5px; color: #9fe0ff; }
  #missions-list .mb-lock { font-size: 11.5px; color: #ffb27a; }
  #missions-list .btn.mb-small { padding: 5px 12px; font-size: 12px; min-width: 0; }
  #mission-tracker .mt-time { color: #ffb27a; font-weight: 700; }
  #mission-tracker .mt-time.low { color: #ff6a6a; }
  #mission-tracker .mt-fail { color: #ff8a8a; font-weight: 700; }
  #mission-tracker .mt-win { color: #7fe39a; font-weight: 700; }
  `;
  document.head.appendChild(s);
}

let tab = null;

// The board. o: { board, stats, creative, guest, onStart(id), onRetry(), onAbandon() }
export function renderBoard(el, o) {
  style();
  const b = o.board;
  const list = b.list(o.stats);
  const cur = list.find((m) => m.state === "current");
  if (!tab) tab = cur?.cat || "foot";
  const rows = [];
  if (o.creative) rows.push(`<p class="hint">Missions run in Survival (switch the game mode in the pause menu). Creative is free play.</p>`);
  const won = list.filter((m) => m.wins > 0).length;
  rows.push(`<div class="mb-head"><span class="mb-rank">${esc(b.rank)}</span><span class="mb-sub">${b.wins} mission${b.wins === 1 ? "" : "s"} won (${won} of ${list.length} different)${b.fails ? ` · ${b.fails} failed` : ""}</span>${o.guest ? `<span class="mb-sub">Online: the host's board (your picks are sent to the host)</span>` : ""}</div>`);
  if (cur) {
    const obj = (cur.objectives || []).map((x) => `${x.value >= x.goal ? "✔" : "○"} ${esc(x.label)}: ${x.value}/${x.goal}`).join(" · ");
    rows.push(`<div class="mb-box"><b>Now: ${esc(cur.title)}</b> (${esc(CATEGORIES.find((c) => c.id === cur.cat)?.name)}, ${esc(cur.tierName)})${b.active ? ` · ${clock(b.active.left)} left` : ""}<div class="mb-brief">${esc(cur.text)}</div><div class="mb-meta">${obj}</div><div style="margin-top:6px"><button class="btn mb-small" data-act="abandon">Abandon</button></div></div>`);
  } else if (b.result) {
    const r = b.result;
    const title = list.find((m) => m.id === r.id)?.title || r.id;
    rows.push(r.ok ? `<div class="mb-box win"><b>Won: ${esc(title)}</b>${r.unlock ? ` · ${esc(r.unlock)}` : ""}<div style="margin-top:6px"><button class="btn mb-small" data-act="retry">Play again</button></div></div>` : `<div class="mb-box fail"><b>Failed: ${esc(title)}</b> · ${esc(r.reason)}<div style="margin-top:6px"><button class="btn mb-small" data-act="retry">Retry</button></div></div>`);
  } else rows.push(`<div class="mb-box">Pick a mission below. Recruit missions are open; win one in a category to open its Veteran ones, and a Veteran one for its Elite ones. The tracker (top right) and the yellow marker show the way.</div>`);
  rows.push(`<div class="mb-tabs">${CATEGORIES.map((c) => {
    const n = list.filter((m) => m.cat === c.id);
    const w = n.filter((m) => m.wins > 0).length;
    return `<button class="mb-tab${c.id === tab ? " on" : ""}" data-tab="${c.id}">${esc(c.name)} ${w}/${n.length}</button>`;
  }).join("")}</div>`);
  const cat = CATEGORIES.find((c) => c.id === tab) || CATEGORIES[0];
  rows.push(`<div class="mb-blurb">${esc(cat.blurb)}</div>`);
  for (const m of list.filter((x) => x.cat === cat.id)) {
    const meta = [`${Math.round(m.limit / 60)} min`, m.vehicle ? `you get ${VEHICLE_LABEL[m.vehicle]}` : "on foot or anything you have", `reward: ${rewardText(m.reward)}`];
    const unlock = m.vehicle && VEHICLE_NAMES[m.vehicle] && !m.wins ? ` · a win unlocks ${VEHICLE_NAMES[m.vehicle]}` : "";
    const btn = m.state === "current" ? `<span class="mb-sub">running</span>` : m.state === "locked" ? `<span class="mb-sub">locked</span>` : `<button class="btn mb-small mb-go-btn" data-start="${m.id}"${cur ? " disabled" : ""}>${m.wins ? "Play again" : "Start"}</button>`;
    rows.push(`<div class="mb-card ${m.state}"><div><span class="mb-title">${esc(m.title)}</span><span class="mb-tier">${stars(m.tier)} ${esc(TIERS[m.tier].name)}</span>${m.wins ? `<span class="mb-done">✔ won${m.wins > 1 ? ` x${m.wins}` : ""}</span>` : ""}</div><div class="mb-go">${btn}</div><div class="mb-brief">${esc(m.brief)}</div><div class="mb-meta">${esc(meta.join(" · "))}${esc(unlock)}</div>${m.lock ? `<div class="mb-lock">${esc(m.lock)}</div>` : ""}</div>`);
  }
  el.innerHTML = rows.join("");
  el.onclick = (e) => {
    const t = e.target.closest("[data-tab],[data-start],[data-act]");
    if (!t) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab;
      renderBoard(el, o);
    } else if (t.dataset.start) o.onStart?.(t.dataset.start);
    else if (t.dataset.act === "abandon") o.onAbandon?.();
    else if (t.dataset.act === "retry") o.onRetry?.();
  };
}

// The tracker's lines for the board (HTML): the mission, its time, its
// objectives, the way to the target; between missions, the last outcome and
// where the board is. o: { board, stats, target, pos, note }
export function trackerHtml(o) {
  style();
  const b = o.board;
  const m = b.mission;
  const parts = [];
  if (m) {
    const left = b.active?.left ?? 0;
    const cat = CATEGORIES.find((c) => c.id === m.cat)?.name || "";
    parts.push(`<div class="mt-head"><span class="mt-title">${esc(m.title)}</span><span class="mt-step">${esc(cat.toUpperCase())} ${stars(m.boardTier || 1)}</span></div>`);
    parts.push(`<div class="mt-text">${esc(m.brief || m.text)}</div>`);
    if (b.active) parts.push(`<div class="mt-time${left < 60 ? " low" : ""}">⏱ ${clock(left)} left</div>`);
    for (const x of b.objectives(o.stats)) {
      const val = Number(x.value) || 0;
      const goal = Number(x.goal) || 1;
      parts.push(`<div class="mt-obj${val >= goal ? " done" : ""}">${val >= goal ? "✔" : "○"} ${esc(x.label)}: ${val}/${goal}</div>`);
      parts.push(`<div class="mt-bar"><div style="width:${Math.round(Math.min(1, val / goal) * 100)}%"></div></div>`);
    }
    const t = o.target;
    if (t) {
      const dx = t.pos.x - o.pos.x;
      const dz = t.pos.z - o.pos.z;
      const dir = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) / 45) % 8];
      parts.push(`<div class="mt-target">◆ ${esc(t.label)}: ${Math.round(Math.hypot(dx, dz))} blocks ${dir}</div>`);
    }
    if (o.note) parts.push(`<div class="mt-note">${esc(o.note)}</div>`);
    parts.push(`<div class="mt-next">M: mission board (abandon, details)</div>`);
  } else {
    const r = b.result;
    if (r && !r.ok && r.reason !== "Abandoned.") parts.push(`<div class="mt-fail">MISSION FAILED</div><div class="mt-text">${esc(r.reason)} Press M to retry it or pick another.</div>`);
    else if (r?.ok) parts.push(`<div class="mt-win">MISSION COMPLETE</div><div class="mt-text">${esc(r.unlock || "")} Press M for the next one.</div>`);
    else parts.push(`<div class="mt-title">NO MISSION</div><div class="mt-text">Press M (or Esc > Missions) to pick one from the board.</div>`);
    parts.push(`<div class="mt-next">${esc(b.rank)} · ${b.wins} won</div>`);
  }
  return parts.join("");
}
