// The aircraft radar (Round 8): a round scope in the bottom-right corner
// while flying any aircraft (the jets, the B-2, a UFO of your own). Heading
// up (what is ahead is at the top; a small "N" on the rim shows north), 2.4 km
// across its rim, with range rings every 800 blocks and a slow sweep.
//
// Symbols:
//   UFO               red diamond (bigger for bigger ships)
//   enemy aircraft    orange arrowhead pointing its way
//   other players     their own colour: a dot on foot, an arrowhead in the air
//   airport           a white runway bar along its real heading
//   missile at you    a blinking red dot with a line to the middle
//   mission target    a yellow star
// Everything farther than the range is pinned to the rim (airports and the
// mission target only: they are where you are going).
const RANGE = 2400; // blocks to the rim
const RINGS = 3;

export class Radar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.visible = false;
    this.sweep = 0;
    this._t = 0;
    this.range = RANGE;
  }

  show(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.canvas.classList.toggle("hidden", !on);
  }

  // state: { pos, heading (radians, 0 = -Z), contacts: [{ kind, x, z, heading?, size?, color?, label? }] }
  draw(dt, state) {
    this._t += dt;
    this.sweep = (this.sweep + dt * 1.6) % (Math.PI * 2);
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = c.clientWidth || 190;
    if (c.width !== Math.round(css * dpr)) {
      c.width = c.height = Math.round(css * dpr);
    }
    const ctx = this.ctx;
    const W = c.width;
    const R = W / 2 - 3 * dpr;
    const cx = W / 2;
    const cy = W / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    // The scope.
    const bg = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    bg.addColorStop(0, "rgba(10,28,44,0.82)");
    bg.addColorStop(1, "rgba(4,12,22,0.86)");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = "rgba(110,190,255,0.22)";
    for (let i = 1; i <= RINGS; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / RINGS, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.stroke();
    // The sweep: a fading wedge.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    const steps = 18;
    for (let i = 0; i < steps; i++) {
      const a0 = this.sweep - (i + 1) * 0.045;
      const a1 = this.sweep - i * 0.045;
      ctx.fillStyle = `rgba(61,155,255,${(0.16 * (1 - i / steps)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0 - Math.PI / 2, a1 - Math.PI / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // Heading up: world (dx, dz) -> screen, rotated by the heading.
    const h = state.heading;
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    const scale = R / this.range;
    const toScreen = (x, z) => {
      const dx = x - state.pos.x;
      const dz = z - state.pos.z;
      // Forward (-Z rotated by the heading) is up on the scope.
      const fx = -Math.sin(h);
      const fz = -Math.cos(h);
      const rx = Math.cos(h);
      const rz = -Math.sin(h);
      const along = dx * fx + dz * fz;
      const side = dx * rx + dz * rz;
      return [cx + side * scale, cy - along * scale];
    };
    void cos;
    void sin;
    // North on the rim.
    {
      const [nx, ny] = toScreen(state.pos.x, state.pos.z - this.range);
      ctx.fillStyle = "rgba(200,225,255,0.8)";
      ctx.font = `700 ${9 * dpr}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const k = (R - 8 * dpr) / R;
      ctx.fillText("N", cx + (nx - cx) * k, cy + (ny - cy) * k);
    }
    const clampRim = (sx, sy, pin) => {
      const dx = sx - cx;
      const dy = sy - cy;
      const d = Math.hypot(dx, dy);
      if (d <= R - 4 * dpr) return [sx, sy, true];
      if (!pin) return null;
      const k = (R - 5 * dpr) / d;
      return [cx + dx * k, cy + dy * k, false];
    };
    const blink = Math.floor(this._t * 5) % 2 === 0;
    // Draw order: airports, mission, players, aircraft, UFOs, missiles (on top).
    const order = { airport: 0, mission: 1, player: 2, jet: 3, ufo: 4, missile: 5 };
    const list = [...state.contacts].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
    for (const ct of list) {
      const [sx0, sy0] = toScreen(ct.x, ct.z);
      const pinned = ct.kind === "airport" || ct.kind === "mission";
      const at = clampRim(sx0, sy0, pinned);
      if (!at) continue;
      const [sx, sy, inside] = at;
      ctx.save();
      ctx.translate(sx, sy);
      const rel = ct.heading !== undefined ? ct.heading - h : 0;
      switch (ct.kind) {
        case "airport": {
          ctx.rotate(-(ct.heading - h));
          ctx.fillStyle = inside ? "rgba(235,242,250,0.9)" : "rgba(235,242,250,0.55)";
          const len = inside ? Math.max(5 * dpr, ct.size * scale) : 6 * dpr;
          ctx.fillRect(-1.6 * dpr, -len / 2, 3.2 * dpr, len);
          break;
        }
        case "mission": {
          ctx.fillStyle = "#ffd84d";
          star(ctx, 5 * dpr);
          break;
        }
        case "player": {
          ctx.fillStyle = ct.color || "#5fd0ff";
          if (ct.air) {
            ctx.rotate(-rel);
            arrow(ctx, 5 * dpr);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, 3 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case "jet": {
          ctx.rotate(-rel);
          ctx.fillStyle = "#ff9a2e";
          arrow(ctx, 5 * dpr);
          break;
        }
        case "ufo": {
          const s = (3 + Math.min(4, ct.size || 1)) * dpr;
          ctx.fillStyle = ct.boss ? "#ff3060" : "#ff4a3a";
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s, 0);
          ctx.lineTo(0, s);
          ctx.lineTo(-s, 0);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "missile": {
          ctx.restore();
          ctx.save();
          ctx.strokeStyle = "rgba(255,60,50,0.55)";
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(sx, sy);
          ctx.stroke();
          if (blink) {
            ctx.fillStyle = "#ff2a20";
            ctx.beginPath();
            ctx.arc(sx, sy, 3.2 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
      }
      ctx.restore();
    }
    // Us: a small aircraft at the middle, pointing up.
    ctx.fillStyle = "#e9f3ff";
    ctx.save();
    ctx.translate(cx, cy);
    arrow(ctx, 5.5 * dpr);
    ctx.restore();
    // The rim and the range.
    ctx.strokeStyle = "rgba(110,190,255,0.55)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(200,225,255,0.6)";
    ctx.font = `600 ${8 * dpr}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${(this.range / 1000).toFixed(1)} km`, W - 4 * dpr, W - 2 * dpr);
  }
}

function arrow(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.75, s * 0.8);
  ctx.lineTo(0, s * 0.35);
  ctx.lineTo(-s * 0.75, s * 0.8);
  ctx.closePath();
  ctx.fill();
}

function star(ctx, s) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? s * 0.45 : s;
    if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
