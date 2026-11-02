// What the pilot reads in space (Round 16, js/solar.js): the flight panel
// (where, how high, how fast, the time warp, the rocket's throttle, orbit
// and assist), the assist's cue and marker, the guides (N: a marker on every
// planet with its name, its distance and the time to get there at this
// speed; an arrow at the edge of the view for one off screen; the target
// marked) and the map (M: a view from above of the orbits, the planets, the
// ship and its path ahead; the wheel zooms, out to the whole solar system).
import { BODIES, BODY_IDS, absState, elements, len, norm, fmtDist, fmtSpeed, fmtTime, C_LIGHT } from "./solar-data.js";
import { CONTROLS } from "./menu.js";
import * as THREE from "three";

const _d = new THREE.Vector3();
const _p = {};

// (Round 16) Space's keys in the controls list (Settings > Controls, the main menu's).
CONTROLS.push([
  "Space (rocket and UFOs above the space line)",
  [
    ["Climb", "A rocket or any UFO that climbs past the space line (6,000 m over Earth, 3,000 over the Moon, 4,500 over Mars) flies on into space, no cutscene. Fly down into a planet to land on it"],
    ["N", "Guides on / off: every planet's name, distance and time to get there at your speed; arrows at the edge for ones off screen"],
    ["T / Shift+T", "Next / previous target (marked; the rocket's assist plans the way to it)"],
    ["M", "Map: orbits, planets, your path ahead (mouse wheel zooms out to the whole solar system)"],
    [", and .", "Time warp down / up: 1x to 100,000x (drops by itself near a planet and on thrust); / back to 1x"],
    ["Rocket: Space / Shift", "Throttle up / down (Z full, X off)"],
    ["Rocket: W A S D, Q / E", "Tilt the nose the way the camera sees it; roll"],
    ["Rocket: R", "Assist on / off: points the nose into orbit, for the burn to the target, and for the landing; tells you when to burn and when to cut the engine"],
    ["UFO: mouse wheel", "Cruising speed: up to a fifth of the speed of light out in space (slower near a planet)"],
    ["Warp Saucer: J", "Warp drive on / off (in space, away from planets); mouse wheel: warp factor 1c to 10,000c; the mouse steers; it drops out by itself in front of a planet"],
  ],
]);

const CSS = `
#solar-hud { position: fixed; inset: 0; pointer-events: none; z-index: 28; font-family: "Segoe UI", system-ui, sans-serif; color: #e8f1ff; display: none; }
body.in-space #solar-hud { display: block; }
body.hud-off #solar-hud { display: none; }
#solar-hud .panel { position: absolute; left: 14px; bottom: 14px; min-width: 250px; padding: 10px 12px; border-radius: 8px; background: rgba(6, 12, 24, 0.62); border: 1px solid rgba(140, 190, 255, 0.25); font-size: 13px; line-height: 1.45; }
#solar-hud .panel .t { font: 700 14px "Segoe UI", system-ui, sans-serif; letter-spacing: 1px; color: #9fd0ff; margin-bottom: 4px; }
#solar-hud .panel .r { display: flex; justify-content: space-between; gap: 14px; }
#solar-hud .panel .r b { font-weight: 600; color: #fff; }
#solar-hud .bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.12); margin: 4px 0 2px; overflow: hidden; }
#solar-hud .bar i { display: block; height: 100%; background: linear-gradient(90deg, #ffb347, #ff6a2a); }
#solar-hud .warp { position: absolute; right: 14px; top: 14px; font: 700 15px "Segoe UI", system-ui, sans-serif; padding: 6px 10px; border-radius: 6px; background: rgba(6, 12, 24, 0.55); color: #cfe7ff; }
#solar-hud .warp.on { color: #ffe08a; border: 1px solid rgba(255, 224, 138, 0.5); }
#solar-hud .tgt { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); font-size: 14px; padding: 5px 12px; border-radius: 6px; background: rgba(6, 12, 24, 0.5); white-space: nowrap; }
#solar-hud .cue { position: absolute; left: 50%; top: 47%; transform: translateX(-50%); font: 800 26px "Segoe UI", system-ui, sans-serif; letter-spacing: 3px; text-shadow: 0 2px 8px #000; white-space: nowrap; }
#solar-hud .cue.burn { color: #ffb347; }
#solar-hud .cue.cut { color: #8fffb0; }
#solar-hud .cue.wait { color: #cfe7ff; font-size: 18px; }
#solar-hud .cue small { display: block; font: 500 14px "Segoe UI", system-ui, sans-serif; letter-spacing: 0; text-align: center; color: #e8f1ff; }
#solar-hud .help { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); font-size: 12px; opacity: 0.8; white-space: nowrap; text-shadow: 0 1px 4px #000; }
#solar-hud .mk { position: absolute; transform: translate(-50%, -50%); font-size: 12px; white-space: nowrap; text-shadow: 0 1px 3px #000; }
#solar-hud .mk .o { width: 14px; height: 14px; border: 2px solid currentColor; border-radius: 50%; margin: 0 auto 2px; }
#solar-hud .mk.tg .o { border-radius: 2px; transform: rotate(45deg); width: 16px; height: 16px; box-shadow: 0 0 8px currentColor; }
#solar-hud .mk .l { text-align: center; line-height: 1.25; }
#solar-hud .mk .l b { font-weight: 700; }
#solar-hud .arrow { position: absolute; transform: translate(-50%, -50%); font-size: 12px; white-space: nowrap; text-shadow: 0 1px 3px #000; }
#solar-hud .arrow .a { width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 14px solid currentColor; margin: 0 auto 2px; }
#solar-hud .aim { position: absolute; width: 26px; height: 26px; transform: translate(-50%, -50%); border: 2px dashed #ffb347; border-radius: 50%; }
#solar-hud .aim::after { content: ""; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: #ffb347; }
#solar-map { position: fixed; inset: 0; z-index: 27; display: none; pointer-events: none; }
body.in-space.space-map #solar-map { display: block; }
body.in-space.space-map #solar-hud .mk, body.in-space.space-map #solar-hud .arrow, body.in-space.space-map #solar-hud .aim { display: none; }
body.in-space #hud, body.in-space #vehicle-hud, body.in-space #vehicle-prompt, body.in-space #mission-tracker, body.in-space #mission-marker, body.in-space #boss-bar, body.in-space #missile-warn, body.in-space #lock-box, body.in-space #radar, body.in-space #crosshair, body.in-space #fighter-hud { visibility: hidden; }
`;

export class SolarUI {
  constructor(solar) {
    this.solar = solar;
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    const el = document.createElement("div");
    el.id = "solar-hud";
    el.innerHTML = `<div class="panel"></div><div class="warp"></div><div class="tgt"></div><div class="cue"></div><div class="aim"></div><div class="marks"></div><div class="help"></div>`;
    document.body.appendChild(el);
    this.el = el;
    this.panel = el.querySelector(".panel");
    this.warpEl = el.querySelector(".warp");
    this.tgtEl = el.querySelector(".tgt");
    this.cueEl = el.querySelector(".cue");
    this.aimEl = el.querySelector(".aim");
    this.marks = el.querySelector(".marks");
    this.helpEl = el.querySelector(".help");
    this.map = document.createElement("canvas");
    this.map.id = "solar-map";
    document.body.appendChild(this.map);
    this._t = 0;
    this._markEls = {};
    this.lastGuides = []; // (tests: what the guides showed)
  }

  show(on) {
    if (!on) {
      document.body.classList.remove("space-map");
      this.lastGuides = [];
    }
  }

  update(dt) {
    const S = this.solar;
    const c = S.craft;
    if (!c) return;
    document.body.classList.toggle("space-map", S.mapOpen);
    this._guides(c);
    if (S.mapOpen) this._map(c);
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.1;
    this._panel(c);
  }

  // ---------- The flight panel ----------

  _panel(c) {
    const S = this.solar;
    const B = BODIES[c.ref];
    const alt = len(c.r) - B.r;
    const sp = c.warpOn ? c.warpSpeed || len(c.vel) : len(c.vel);
    const rows = [];
    rows.push(["Near", B.label]);
    rows.push([B.dim ? "Altitude" : "Height", fmtDist(alt)]);
    rows.push(["Speed", fmtSpeed(sp)]);
    let bar = "";
    if (c.kind === "rocket") {
      const el = elements(c.r, c.vel, B.gm);
      const lo = el.rp - B.r;
      rows.push(["Path", el.e < 1 ? `${lo < 0 ? "down into the ground" : `low ${fmtDist(lo)}`}, high ${fmtDist(el.ra - B.r)}` : lo < 0 ? "down into the ground" : `escaping (low ${fmtDist(lo)})`]);
      rows.push(["Stage", c.v.stack === "ship" ? "Ship" : "Core (falls away soon)"]);
      rows.push(["Assist (R)", c.assist ? c.plan?.mode || "on" : "off"]);
      bar = `<div class="r"><span>Throttle</span><b>${Math.round(c.throttle * 100)}%</b></div><div class="bar"><i style="width:${Math.round(c.throttle * 100)}%"></i></div>`;
    } else {
      if (c.kind === "warp") rows.push(["Warp drive (J)", c.warpOn ? `${c.warpFactor.toLocaleString("en-US")}c` : `ready: ${c.warpFactor.toLocaleString("en-US")}c`]);
      if (!c.warpOn) rows.push(["Cruise (wheel)", fmtSpeed(S.cruise(c))]);
    }
    this.panel.innerHTML = `<div class="t">${esc(c.v.name || "Ship")} · IN SPACE</div>${rows.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}${bar}`;
    const tw = S.timeWarp;
    this.warpEl.className = `warp${tw > 1 || c.warpOn ? " on" : ""}`;
    this.warpEl.textContent = c.warpOn ? `WARP ${(sp / C_LIGHT).toFixed(sp < 10 * C_LIGHT ? 1 : 0)}c` : `Time ${tw.toLocaleString("en-US")}x`;
    // the target
    if (S.target) {
      const T = BODIES[S.target];
      const d = this._dist(c, S.target);
      const eta = sp > 1 ? d / sp : Infinity;
      this.tgtEl.style.display = "block";
      this.tgtEl.innerHTML = `Target: <b style="color:${T.color}">${esc(T.label)}</b> · ${esc(fmtDist(d))}${Number.isFinite(eta) ? ` · ${esc(fmtTime(eta))} at this speed` : ""}`;
    } else this.tgtEl.style.display = "none";
    // the assist's cue
    const P = c.kind === "rocket" && c.assist ? c.plan : null;
    if (P && P.text) {
      const big = P.cue === "burn" ? (P.aligned ? "BURN" : "TURNING...") : P.cue === "cut" ? "CUT ENGINE" : "";
      this.cueEl.className = `cue ${P.cue || "wait"}`;
      this.cueEl.innerHTML = `${big}<small>${esc(P.text)}</small>`;
    } else if (c.kind === "warp" && c.warpOn && c.warpK > 0.9 && (c.warpSpeed || 0) < c.warpFactor * C_LIGHT * 0.95) {
      this.cueEl.className = "cue wait";
      this.cueEl.innerHTML = `<small>The drive slows near ${esc(BODIES[S._nearest(c).id].name)}</small>`;
    } else this.cueEl.innerHTML = "";
    this.helpEl.textContent =
      c.kind === "rocket"
        ? "Space/Shift throttle · Z full · X off · W A S D tilt · Q/E roll · R assist · mouse camera · M map · N guides · T target · , . time warp"
        : c.kind === "warp"
          ? "J warp · wheel warp factor / speed · mouse steer · W A S D move · Space/Shift up/down · M map · N guides · T target · , . time warp"
          : "W A S D move · Space/Shift up/down · wheel speed · Ctrl boost · M map · N guides · T target · , . time warp · fly down to land";
  }

  _dist(c, id) {
    const me = this.solar.absOf(c);
    const a = absState(id, this.solar.t);
    return Math.max(0, Math.hypot(a[0] - me[0], a[1] - me[1], a[2] - me[2]) - BODIES[id].r);
  }

  // ---------- The guides ----------

  _guides(c) {
    const S = this.solar;
    const view = S.view;
    const w = window.innerWidth || 960;
    const h = window.innerHeight || 540;
    const show = S.guides && !S.mapOpen;
    this.marks.style.display = show ? "block" : "none";
    const me = S.absOf(c);
    const camAbs = [me[0] + c.camOff.x, me[1] + c.camOff.y, me[2] + c.camOff.z];
    const sp = c.warpOn ? c.warpSpeed || len(c.vel) : len(c.vel);
    const out = [];
    for (const id of BODY_IDS) {
      const B = BODIES[id];
      let m = this._markEls[id];
      if (!m) {
        m = this._markEls[id] = document.createElement("div");
        this.marks.appendChild(m);
      }
      if (!show) continue;
      const a = absState(id, S.t);
      _d.set(a[0] - camAbs[0], a[1] - camAbs[1], a[2] - camAbs[2]);
      const dist = Math.max(0, _d.length() - B.r);
      // (the body filling the view below: no marker on it)
      // (the body filling the view below, or the one the ship is right over: no marker on it)
      const big = (view.apparent?.[id] || 0) > Math.min(w, h) * 0.6 || (id === c.ref && dist < B.r);
      view.project(_d.normalize().multiplyScalar(1000), w, h, _p);
      const on = !_p.behind && _p.x > 20 && _p.x < w - 20 && _p.y > 20 && _p.y < h - 20;
      const tg = id === S.target;
      const eta = sp > 1 ? dist / sp : Infinity;
      const label = `<b>${esc(B.label)}</b><br>${esc(fmtDist(dist))}${tg || dist < 1e9 ? (Number.isFinite(eta) ? `<br>${esc(fmtTime(eta))}` : "") : ""}`;
      if (big) {
        m.style.display = "none";
        continue;
      }
      if (on) {
        m.className = `mk${tg ? " tg" : ""}`;
        m.style.display = "block";
        m.style.left = `${_p.x}px`;
        m.style.top = `${_p.y}px`;
        m.style.color = tg ? "#ffe08a" : B.color;
        m.innerHTML = `<div class="o"></div><div class="l">${label}</div>`;
        out.push({ id, on: true, x: _p.x, y: _p.y, dist, eta });
      } else {
        // an arrow at the edge, pointing the way
        let vx = _p.vx;
        let vy = _p.vy;
        if (_p.behind) {
          vx = -vx;
          vy = -vy;
        }
        const k = 1 / Math.max(Math.abs(vx), Math.abs(vy), 1e-6);
        const ex = (vx * k * 0.5 + 0.5) * (w - 90) + 45;
        const ey = (-vy * k * 0.5 + 0.5) * (h - 90) + 45;
        const ang = Math.atan2(vx, vy);
        m.className = "arrow";
        m.style.display = tg || dist < 5e8 || B.star ? "block" : "none";
        m.style.left = `${ex}px`;
        m.style.top = `${ey}px`;
        m.style.color = tg ? "#ffe08a" : B.color;
        m.innerHTML = `<div class="a" style="transform:rotate(${ang}rad)"></div><div class="l">${label}</div>`;
        out.push({ id, on: false, x: ex, y: ey, dist, eta });
      }
    }
    this.lastGuides = out;
    // the assist's marker: where it wants the nose
    const P = c.kind === "rocket" && c.assist ? c.plan : null;
    if (P?.dir && !S.mapOpen) {
      _d.set(P.dir[0], P.dir[1], P.dir[2]).multiplyScalar(1000);
      view.project(_d, w, h, _p);
      const on = !_p.behind && _p.x > 0 && _p.x < w && _p.y > 0 && _p.y < h;
      this.aimEl.style.display = on ? "block" : "none";
      this.aimEl.style.left = `${_p.x}px`;
      this.aimEl.style.top = `${_p.y}px`;
    } else this.aimEl.style.display = "none";
  }

  // ---------- The map ----------

  _map(c) {
    const S = this.solar;
    const cv = this.map;
    const w = window.innerWidth || 960;
    const h = window.innerHeight || 540;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const g = cv.getContext("2d");
    g.fillStyle = "rgba(2, 5, 12, 0.86)";
    g.fillRect(0, 0, w, h);
    // the focus: the body the ship is near, or its parent when zoomed far out
    let focus = c.ref;
    const B0 = BODIES[focus];
    const base = Math.max(len(c.r) * 1.6, B0.r * 5, ...B0.children.map((id) => BODIES[id].a * 1.25), focus === "sun" ? BODIES.mars.a * 1.3 : 0);
    let extent = base / S.mapZoom;
    while (BODIES[focus].parent && extent > BODIES[focus].soi * 1.2) focus = BODIES[focus].parent;
    const F = absState(focus, S.t);
    const px = (Math.min(w, h) * 0.45) / extent;
    const sx = (x) => w / 2 + (x - F[0]) * px;
    const sy = (z) => h / 2 + (z - F[2]) * px;
    g.font = "12px Segoe UI, system-ui, sans-serif";
    // orbits
    for (const id of BODY_IDS) {
      const B = BODIES[id];
      if (!B.parent) continue;
      const P = absState(B.parent, S.t);
      const rr = B.a * px;
      if (rr < 3 || rr > w * 20) continue;
      g.strokeStyle = id === S.target ? "rgba(255, 224, 138, 0.55)" : "rgba(140, 180, 255, 0.22)";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(sx(P[0]), sy(P[2]), rr, 0, Math.PI * 2);
      g.stroke();
    }
    // the path ahead
    const path = S.predict ? S.predict(c, 360) : null;
    if (path && path.length > 1) {
      g.strokeStyle = "#7dffb0";
      g.lineWidth = 2;
      g.beginPath();
      path.forEach((p, i) => {
        // (relative to the focus where it will be then)
        const f = absState(focus, p.t);
        const X = w / 2 + (p.abs[0] - f[0]) * px;
        const Y = h / 2 + (p.abs[2] - f[2]) * px;
        if (i) g.lineTo(X, Y);
        else g.moveTo(X, Y);
      });
      g.stroke();
    }
    // the bodies
    for (const id of BODY_IDS) {
      const B = BODIES[id];
      const a = absState(id, S.t);
      const X = sx(a[0]);
      const Y = sy(a[2]);
      if (X < -50 || X > w + 50 || Y < -50 || Y > h + 50) continue;
      const rr = Math.max(B.star ? 6 : 3, B.r * px);
      g.fillStyle = B.color;
      g.beginPath();
      g.arc(X, Y, rr, 0, Math.PI * 2);
      g.fill();
      if (id === S.target) {
        g.strokeStyle = "#ffe08a";
        g.lineWidth = 2;
        g.strokeRect(X - rr - 5, Y - rr - 5, (rr + 5) * 2, (rr + 5) * 2);
      }
      g.fillStyle = "#e8f1ff";
      g.fillText(B.label, X + rr + 6, Y + 4);
    }
    // the ship
    const me = S.absOf(c);
    const X = sx(me[0]);
    const Y = sy(me[2]);
    const vv = norm(c.vel.some((x) => x) ? c.vel : [1, 0, 0]);
    const ang = Math.atan2(vv[2], vv[0]);
    g.save();
    g.translate(X, Y);
    g.rotate(ang);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(9, 0);
    g.lineTo(-6, 5);
    g.lineTo(-6, -5);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = "#cfe7ff";
    g.font = "14px Segoe UI, system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText(`Map: round ${BODIES[focus].label} · ${fmtDist(extent)} across half the view · mouse wheel zooms · M closes`, 14, 64);
    if (c.kind === "rocket" && c.plan?.eta) g.fillText(`Planned arrival: ${fmtTime(c.plan.eta)}`, 14, 84);
  }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

