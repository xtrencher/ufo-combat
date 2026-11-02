// The canyon run's screen on the main menu (Round 15): the courses (their
// length, the player's best time and medal, the par times), the jet (F-22 or
// F-16, remembered), and "Fly!", which opens the run's page (js/canyon.js:
// ?canyon=<course>&jet=<type>; the player's own world is saved first and
// left as it is). The screen is made here; index.html has its button.
import { CANYON_COURSES, canyonUrl, loadRecords, medalTimes, formatTime } from "./canyon.js";
import { loadJSON, saveJSON } from "./storage.js";

const JETS = [
  { id: "f22", name: "F-22 Raptor", note: "Faster, tougher" },
  { id: "f16", name: "F-16 Falcon", note: "Lighter, turns tighter" },
];

// screens: main.js's MenuScreens; audio; beforeLeave(): save the world in
// hand (main.js); refusal(): why not now (online), or null.
export function installCanyonMenu({ screens, audio = null, beforeLeave = null, refusal = null, toast = null } = {}) {
  const btn = document.getElementById("menu-canyon-btn");
  if (!btn || !screens) return null;
  injectStyle();
  const pref = loadJSON("canyon_pref") || {};
  let course = CANYON_COURSES.find((c) => c.id === pref.course) || CANYON_COURSES[0];
  let jet = pref.jet === "f16" ? "f16" : "f22";

  const el = document.createElement("div");
  el.id = "canyon-screen";
  el.className = "overlay hidden";
  el.innerHTML = `
    <div class="panel wide cy-menu">
      <h2>Canyon run <small>single player</small></h2>
      <div class="hint">Fly a jet through a huge winding canyon as fast as you can: through every ring, under the arches, between the walls. Touch the rock and it is over.</div>
      <div class="cy-courses"></div>
      <div class="subhead">Your jet</div>
      <div class="cy-jets"></div>
      <div class="hint cy-controls">The mouse steers (the jet banks and pulls toward the crosshair), W/S throttle, Shift afterburner, Space air brakes, left click guns, right click missiles. R flies again at any time.</div>
      <div class="menu-buttons">
        <button class="btn big primary" id="canyon-fly">Fly!</button>
        <button class="btn secondary" id="canyon-back" type="button">Back</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const list = el.querySelector(".cy-courses");
  const jets = el.querySelector(".cy-jets");

  function render() {
    const rec = loadRecords();
    list.innerHTML = "";
    for (const c of CANYON_COURSES) {
      const r = rec[c.id];
      const m = medalTimes(c);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `cy-course-card ${c.id === course.id ? "active" : ""} k-${c.kind}`;
      b.innerHTML = `
        <div class="cy-cc-head"><b>${c.name}</b>${r?.medal ? `<i class="cy-dot ${r.medal}" title="${r.medal} medal"></i>` : ""}</div>
        <small>${c.blurb}</small>
        <div class="cy-cc-foot"><span>${(c.length / 1000).toFixed(1)} km</span><span>${Number.isFinite(r?.best) ? `Best ${formatTime(r.best)}` : `Gold ${formatTime(m.gold)}`}</span></div>`;
      b.addEventListener("click", () => {
        course = c;
        audio?.playClick?.();
        render();
      });
      b.addEventListener("dblclick", fly);
      list.appendChild(b);
    }
    jets.innerHTML = "";
    for (const j of JETS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `mp-mode cy-jet ${j.id === jet ? "active" : ""}`;
      b.innerHTML = `<b>${j.name}</b><small>${j.note}</small>`;
      b.addEventListener("click", () => {
        jet = j.id;
        audio?.playClick?.();
        render();
      });
      jets.appendChild(b);
    }
  }

  function fly() {
    const why = refusal?.();
    if (why) {
      toast?.(why, 3);
      return;
    }
    audio?.playClick?.();
    saveJSON("canyon_pref", { course: course.id, jet });
    try {
      beforeLeave?.();
    } catch (err) {
      console.error("MINECLAUDE: saving before the canyon run failed", err);
    }
    window.location.href = canyonUrl(course, jet);
  }

  btn.addEventListener("click", () => {
    audio?.ensureStarted?.();
    audio?.playClick?.();
    render();
    screens.show("canyon-screen", "start-menu");
  });
  el.querySelector("#canyon-fly").addEventListener("click", fly);
  el.querySelector("#canyon-back").addEventListener("click", () => screens.back());
  return { el, render, fly };
}

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
  #menu-canyon-btn { background: linear-gradient(90deg, rgba(214,104,40,0.42), rgba(255,255,255,0.05) 75%); border-color: rgba(255,160,90,0.45); }
  #menu-canyon-btn:hover { background: linear-gradient(90deg, rgba(234,124,50,0.6), rgba(255,255,255,0.1) 75%); border-color: rgba(255,180,110,0.8); }
  #menu-canyon-btn small { font-size: 11px; opacity: 0.7; font-weight: 600; letter-spacing: 1px; }
  .cy-menu { max-width: 640px; }
  .cy-menu h2 small { font-size: 12px; font-weight: 600; letter-spacing: 1.5px; color: var(--ui-dim, #aab); margin-left: 8px; text-transform: uppercase; }
  .cy-courses { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0 6px; }
  .cy-course-card { text-align: left; font: inherit; color: var(--ui-text, #eee); cursor: pointer; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--ui-line, rgba(255,255,255,0.12)); background: linear-gradient(160deg, rgba(190,90,40,0.22), rgba(255,255,255,0.03)); transition: background 0.15s, border-color 0.15s, transform 0.12s; }
  .cy-course-card.k-slot { background: linear-gradient(160deg, rgba(200,130,60,0.22), rgba(255,255,255,0.03)); }
  .cy-course-card.k-night { background: linear-gradient(160deg, rgba(60,80,170,0.3), rgba(255,255,255,0.03)); }
  .cy-course-card.k-gauntlet { background: linear-gradient(160deg, rgba(170,40,40,0.28), rgba(255,255,255,0.03)); }
  .cy-course-card:hover { transform: translateY(-1px); border-color: rgba(255,180,110,0.6); }
  .cy-course-card.active { border-color: #ffb46b; box-shadow: inset 0 0 0 1px rgba(255,180,110,0.35), 0 0 16px rgba(255,150,70,0.18); }
  .cy-cc-head { display: flex; align-items: center; justify-content: space-between; }
  .cy-cc-head b { font-size: 15px; letter-spacing: 0.4px; }
  .cy-course-card small { display: block; font-size: 11.5px; line-height: 1.35; opacity: 0.75; margin: 4px 0 6px; min-height: 31px; }
  .cy-cc-foot { display: flex; justify-content: space-between; font: 600 11px ui-monospace, Consolas, monospace; color: #ffd9a8; }
  .cy-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .cy-dot.gold { background: #f2c641; box-shadow: 0 0 8px #f2c641; } .cy-dot.silver { background: #cfd7df; } .cy-dot.bronze { background: #c27a3c; }
  .cy-jets { display: flex; gap: 10px; margin: 6px 0 8px; }
  .cy-jets .cy-jet { flex: 1; }
  .cy-controls { font-size: 11.5px; margin-bottom: 10px; }
  @media (max-width: 620px) { .cy-courses { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(s);
}
