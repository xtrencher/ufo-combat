// The canyon run's screen on the main menu (Round 15): the courses (their
// length, the player's best time and medal, the par times), the jet (F-22 or
// F-16, remembered), and "Fly!", which opens the run's page (js/canyon.js:
// ?canyon=<course>&jet=<type>; the player's own world is saved first and
// left as it is). The screen is made here; index.html has its button.
// (Round 16) The run's options, remembered with the rest: the difficulty
// (how wide the canyon is: Easy .. Insane), the scenery (the course's own,
// a biome, a mix of them, or a random one; Round 17: or Space, the whole
// run among the asteroids), open stretches (Round 17: valleys only: none,
// some, lots), the rings (Round 17: off by default), enemy jets (none, few, some, many) and what a
// crash does (back at the last checkpoint, the default, or the course
// again). The best times shown are the ones for the options picked.
// (Round 17) The time of day (day, dusk, night: held all run long; records shared).
import { CANYON_COURSES, canyonUrl, loadRecords, medalTimes, formatTime, recordId } from "./canyon.js";
import { courseOf, canyonSeed, BIOME_MIXED, BIOME_SPACE } from "./dim-canyon.js";
import { CANYON_BIOMES, BIOME_ORDER, CANYON_DIFFS, DIFF_ORDER, OPEN_ORDER, CANYON_OPENS } from "./canyon-biomes.js";
import { BOT_LEVELS } from "./canyon-bots.js";
import { loadJSON, saveJSON } from "./storage.js";

const JETS = [
  { id: "f22", name: "F-22 Raptor", note: "Faster, tougher" },
  { id: "f16", name: "F-16 Falcon", note: "Lighter, turns tighter" },
];
// (Round 16) The options' choices: [value, label, note].
// (Round 17: Space, the whole run among the asteroids, a scenery of its own: never Mixed's or Random's)
const BIOMES = [["default", "Course's own", ""], ...BIOME_ORDER.map((id) => [id, CANYON_BIOMES[id].name, CANYON_BIOMES[id].note]), [BIOME_MIXED, "Mixed", "One after another"], ["random", "Random", "A surprise each time"], [BIOME_SPACE, "Space", "The whole run among the asteroids"]];
const DIFFS = DIFF_ORDER.map((id) => [id, CANYON_DIFFS[id].name, CANYON_DIFFS[id].note]);
const OPENS = OPEN_ORDER.map((id) => [id, CANYON_OPENS[id].name, { none: "Canyon all the way", some: "An open valley now and then", lots: "Often" }[id]]);
const BOTS = BOT_LEVELS.map((b) => [b.id, b.name, { none: "A time trial", few: "Two at a time", some: "Four at a time", many: "Six at a time" }[b.id]]);
const CRASH = [["checkpoint", "Respawn at checkpoint", "Back at the last checkpoint passed"], ["restart", "Restart the course", "A crash ends the run"]];
// (Round 17) The rings to fly through: off by default (the checkpoints stay, unseen, no penalty).
const RINGS = [["off", "Off", "Checkpoints only, no penalty"], ["on", "On", "Fly through each ring: +5 s a miss"]];
// (Round 17) The time of day, held all run (no day going by).
const TIMES = [["day", "Day", "Sun high all run"], ["dusk", "Dusk", "Low sun, long shadows"], ["night", "Night", "Moonlight and crystals"]];

// The course spec a set of options makes (for its record and par times).
function specFor(course, o) {
  const biome = o.biome === "default" || o.biome === "random" || o.biome === course.biome ? null : o.biome;
  return courseOf(canyonSeed(course.seed, { biome, diff: o.diff, open: o.open === "some" ? null : o.open }));
}

// screens: main.js's MenuScreens; audio; beforeLeave(): save the world in
// hand (main.js); refusal(): why not now (online), or null.
export function installCanyonMenu({ screens, audio = null, beforeLeave = null, refusal = null, toast = null } = {}) {
  const btn = document.getElementById("menu-canyon-btn");
  if (!btn || !screens) return null;
  injectStyle();
  const pref = loadJSON("canyon_pref") || {};
  let course = CANYON_COURSES.find((c) => c.id === pref.course) || CANYON_COURSES[0];
  let jet = pref.jet === "f16" ? "f16" : "f22";
  const pick = (list, v, def) => (list.some((x) => x[0] === v) ? v : def);
  const opts = {
    diff: pick(DIFFS, pref.diff, "normal"),
    biome: pick(BIOMES, pref.biome, "default"),
    open: pick(OPENS, pref.open, "some"),
    bots: pick(BOTS, pref.bots, "none"),
    crash: pick(CRASH, pref.crash, "checkpoint"),
    rings: pick(RINGS, pref.rings, "off"),
    time: pick(TIMES, pref.time, "day"),
  };

  const el = document.createElement("div");
  el.id = "canyon-screen";
  el.className = "overlay hidden";
  el.innerHTML = `
    <div class="panel wide cy-menu">
      <h2>Canyon run <small>single player</small></h2>
      <div class="hint">Fly a jet through a huge winding canyon as fast as you can: past every checkpoint, under the arches, between the walls. Touch the rock and you're back at the last checkpoint.</div>
      <div class="cy-courses"></div>
      <div class="cy-opt-grid">
        <div class="cy-opt"><div class="subhead">Difficulty <span class="cy-opt-note" data-note="diff"></span></div><div class="cy-seg" data-opt="diff"></div></div>
        <div class="cy-opt"><div class="subhead">Enemy jets <span class="cy-opt-note" data-note="bots"></span></div><div class="cy-seg" data-opt="bots"></div></div>
        <div class="cy-opt wide"><div class="subhead">Scenery <span class="cy-opt-note" data-note="biome"></span></div><div class="cy-seg cy-wrap" data-opt="biome"></div></div>
        <div class="cy-opt"><div class="subhead">Open stretches <span class="cy-opt-note" data-note="open"></span></div><div class="cy-seg" data-opt="open"></div></div>
        <div class="cy-opt"><div class="subhead">After a crash <span class="cy-opt-note" data-note="crash"></span></div><div class="cy-seg" data-opt="crash"></div></div>
        <div class="cy-opt"><div class="subhead">Rings <span class="cy-opt-note" data-note="rings"></span></div><div class="cy-seg" data-opt="rings"></div></div>
        <div class="cy-opt"><div class="subhead">Time <span class="cy-opt-note" data-note="time"></span></div><div class="cy-seg" data-opt="time"></div></div>
      </div>
      <div class="subhead">Your jet</div>
      <div class="cy-jets"></div>
      <div class="hint cy-controls">The mouse steers (the jet banks and pulls toward the crosshair), W/S throttle, Shift afterburner, Space air brakes, left click guns, right click missiles. R restarts the course at any time.</div>
      <div class="menu-buttons">
        <button class="btn big primary" id="canyon-fly">Fly!</button>
        <button class="btn secondary" id="canyon-back" type="button">Back</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const list = el.querySelector(".cy-courses");
  const jets = el.querySelector(".cy-jets");
  const CHOICES = { diff: DIFFS, biome: BIOMES, open: OPENS, bots: BOTS, crash: CRASH, rings: RINGS, time: TIMES };

  function render() {
    const rec = loadRecords();
    const bots = Math.max(0, BOT_LEVELS.findIndex((b) => b.id === opts.bots));
    list.innerHTML = "";
    for (const c of CANYON_COURSES) {
      const spec = specFor(c, opts);
      const r = opts.biome === "random" ? null : rec[recordId(spec, bots)];
      const m = medalTimes(spec, bots);
      const scene = opts.biome === "default" ? CANYON_BIOMES[c.biome]?.name || "Mixed" : null;
      const b = document.createElement("button");
      b.type = "button";
      b.className = `cy-course-card ${c.id === course.id ? "active" : ""} k-${c.kind}`;
      b.innerHTML = `
        <div class="cy-cc-head"><b>${c.name}</b>${r?.medal ? `<i class="cy-dot ${r.medal}" title="${r.medal} medal"></i>` : ""}</div>
        <small>${c.blurb}</small>
        <div class="cy-cc-foot"><span>${(c.length / 1000).toFixed(1)} km${scene ? ` · ${scene}` : ""}</span><span>${Number.isFinite(r?.best) ? `Best ${formatTime(r.best)}` : `Gold ${formatTime(m.gold)}`}</span></div>`;
      b.addEventListener("click", () => {
        course = c;
        audio?.playClick?.();
        render();
      });
      b.addEventListener("dblclick", fly);
      list.appendChild(b);
    }
    for (const [key, choices] of Object.entries(CHOICES)) {
      const seg = el.querySelector(`[data-opt="${key}"]`);
      seg.innerHTML = "";
      for (const [v, label, note] of choices) {
        const o = document.createElement("button");
        o.type = "button";
        o.className = `cy-seg-btn ${opts[key] === v ? "active" : ""}`;
        o.dataset.v = v;
        o.title = note || "";
        if (key === "biome" && CANYON_BIOMES[v]) o.style.setProperty("--cy-sw", CANYON_BIOMES[v].card);
        o.textContent = label;
        o.addEventListener("click", () => {
          opts[key] = v;
          audio?.playClick?.();
          render();
        });
        seg.appendChild(o);
      }
      const cur = choices.find((x) => x[0] === opts[key]);
      el.querySelector(`[data-note="${key}"]`).textContent = cur?.[2] ? `· ${cur[2]}` : "";
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
    saveJSON("canyon_pref", { course: course.id, jet, ...opts });
    try {
      beforeLeave?.();
    } catch (err) {
      console.error("MINECLAUDE: saving before the canyon run failed", err);
    }
    window.location.href = canyonUrl(course, jet, opts);
  }

  btn.addEventListener("click", () => {
    audio?.ensureStarted?.();
    audio?.playClick?.();
    render();
    screens.show("canyon-screen", "start-menu");
  });
  el.querySelector("#canyon-fly").addEventListener("click", fly);
  el.querySelector("#canyon-back").addEventListener("click", () => screens.back());
  return { el, render, fly, opts };
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
  #canyon-screen .panel { max-height: 92vh; overflow-y: auto; }
  .cy-menu { max-width: 700px; }
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
  .cy-cc-foot span { white-space: nowrap; }
  .cy-cc-foot { display: flex; justify-content: space-between; gap: 8px; font: 600 11px ui-monospace, Consolas, monospace; color: #ffd9a8; }
  .cy-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .cy-dot.gold { background: #f2c641; box-shadow: 0 0 8px #f2c641; } .cy-dot.silver { background: #cfd7df; } .cy-dot.bronze { background: #c27a3c; }
  .cy-opt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin: 4px 0 6px; }
  .cy-opt.wide { grid-column: 1 / -1; }
  .cy-opt .subhead { margin: 6px 0 4px; }
  .cy-opt-note { font-size: 11px; font-weight: 500; letter-spacing: 0; text-transform: none; opacity: 0.65; }
  .cy-seg { display: flex; gap: 4px; }
  .cy-seg.cy-wrap { flex-wrap: wrap; }
  .cy-seg-btn { flex: 1; font: 600 12px var(--ui-font, sans-serif); color: var(--ui-text, #eee); cursor: pointer; padding: 6px 8px; border-radius: 9px; border: 1px solid var(--ui-line, rgba(255,255,255,0.12)); background: linear-gradient(160deg, var(--cy-sw, rgba(255,255,255,0.06)), rgba(255,255,255,0.03)); white-space: nowrap; transition: background 0.15s, border-color 0.15s; }
  .cy-seg.cy-wrap .cy-seg-btn { flex: 0 1 auto; }
  .cy-seg-btn:hover { border-color: rgba(255,180,110,0.6); }
  .cy-seg-btn.active { border-color: #ffb46b; box-shadow: inset 0 0 0 1px rgba(255,180,110,0.4); background-color: rgba(255,160,80,0.18); }
  .cy-jets { display: flex; gap: 10px; margin: 6px 0 8px; }
  .cy-jets .cy-jet { flex: 1; }
  .cy-controls { font-size: 11.5px; margin-bottom: 10px; }
  @media (max-width: 620px) { .cy-courses, .cy-opt-grid { grid-template-columns: 1fr; } .cy-seg { flex-wrap: wrap; } }
  `;
  document.head.appendChild(s);
}
