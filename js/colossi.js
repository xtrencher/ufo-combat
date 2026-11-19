// (Round 21) The colossi: giant horror creatures for the jets to fight.
// The owner: "creative missions with gigantic aliens ... like from horror
// films, long legs and extremely huge. I want to fight that with my planes.
// It should fight me back, but I should be able to somehow make it creative."
//
// Three of them, each built procedurally (js/colossus-models.js):
//   THE STRIDER (about 210 high at the knees): a small black body slung
//     between six impossibly long, thin legs; a glowing sac and its eyes
//     hang under it. It walks somewhere (a town) one slow, deliberate step at
//     a time; every foot crushes what it lands on and shakes the ground.
//     Weak points: six glowing KNEES (any weapon); three knees gone and it
//     falls (a huge collapse; the fall splits its shell). The SAC: armoured
//     by three bone plates (a super missile / mini-nuke cracks one; missiles
//     chip them); once open (or after the fall) anything hurts it, and it
//     dies with it. It spits acid globs (flak) at aircraft, whips its
//     hanging tendrils at one flying close, and FLYING BETWEEN ITS LEGS
//     tangles it: it stumbles and its knees take double damage a while.
//   THE WATCHER (about 175 high hunched, 210 rearing): a gaunt, hunched,
//     long-armed thing with a cluster of seven red EYES that follows you.
//     It swats aircraft out of the air with its long arms (a telegraphed
//     wind-up), sweeps a beam from its eyes after charging it, and screeches
//     (engines within ~340 blocks stall for a moment). Weak points: the
//     eyes (tough, but x3 while the beam charges: an eye put out then
//     backfires the beam), two WRIST nerves (an arm goes limp), the HEART
//     behind two chest plates (heavy weapons). LURE ITS SWAT INTO THE
//     GROUND (fly low under it): the hand sticks there a few seconds, its
//     wrist and eyes wide open. Blind it (all seven eyes) or kill it.
//   THE HIVE MOTHER (about 110 high, 200 long): a bloated spider-like mass
//     on eight bent legs with six glowing EGG SACS that burst open to launch
//     swarms of small flying parasites that chase aircraft (flares lure
//     them, the afterburner and tight turns shake them; the cannon and the
//     laser pick them off). A sac about to open glows white: hit it then
//     (x3) and the brood dies inside. Its HEART lies under three carapace
//     plates (heavy weapons). It also spits acid.
// All three enrage at half health (faster, more attacks), and every weak
// point is a lock-on target (the jets' missiles, colossusAimTargets) and a
// marker on the HUD (weak points: orange; armour: grey, "heavy weapons").
//
// How the weapons reach them: js/ufos.js asks its `extras` (this manager)
// in raycast / sphereHit / explosion, so every weapon that hits UFOs (the
// jets' cannon, laser pulses, missiles, the super missile and the
// mini-nuke's blast, the tanks', the helicopters', the guns on foot) hits a
// colossus's parts too; each part is a UFO-like object whose `extDamage` the
// UFO manager's damage() hands the hit to (with the armour rules here).
//
// Online the host simulates them (their walk, attacks, health, the swarm);
// guests draw puppets from compact snapshots (js/net/colossi.js: the root,
// the walk's distance, the phase, every weak point's state, the attack in
// progress) and animate the legs themselves (the same stepping rules from
// the same root, so the feet land where the host's do); each machine judges
// the attacks on its own player and aircraft (as the AI's shots are), and a
// guest's hits go to the host.
import * as THREE from "three";
import { colossusMaterials, makeLimb, placeLimb, makeBall, setLod, solveKnee, lumpyGeometry, spikeGeometry, plateGeometry, ribGeometry, parasiteGeometry, ballGeometry, seeded, HIDE_COLORS } from "./colossus-models.js";
import { ColossusAudio } from "./colossus-audio.js";

const V = () => new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
const _a = V();
const _b = V();
const _c = V();
const _d = V();
const _e = V();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

// The creatures' numbers. hp: the health bar (the "core"); the weak points'
// own health below; transfer: how much of a weak point's damage reaches the
// core; bonus: what destroying one takes off the core on top.
export const COLOSSUS_SPEC = {
  strider: { name: "THE STRIDER", short: "Strider", hp: 10000, speed: 4.2, rage: 6, bound: 175, center: 110 },
  weeper: { name: "THE WATCHER", short: "Watcher", hp: 9000, speed: 3.4, rage: 4.6, bound: 150, center: 95 },
  hive: { name: "THE HIVE MOTHER", short: "Hive Mother", hp: 10000, speed: 2.5, rage: 3.4, bound: 130, center: 60 },
};
export const WEAK = {
  knee: { hp: 1100, transfer: 0.6, bonus: 500, glow: "joint", label: "KNEE" },
  sac: { hp: 3600, transfer: 1, bonus: 0, glow: "sac", label: "SAC" },
  eye: { hp: 450, transfer: 1, bonus: 300, glow: "eye", label: "EYE", tough: 0.4 },
  wrist: { hp: 900, transfer: 0.5, bonus: 400, glow: "wrist", label: "WRIST" },
  heart: { hp: 3200, transfer: 1, bonus: 0, glow: "heart", label: "HEART" },
  egg: { hp: 650, transfer: 0.8, bonus: 500, glow: "egg", label: "EGG SAC" },
};
export const PLATE_HP = 600; // a plate: one heavy hit, or this much from missiles (the cannon and laser do nothing)
export const HEAVY_HIT = 600; // a direct hit this big is "heavy" (the super missile 650, the mini-nuke 900)
export const HEAVY_BLAST = 12; // a blast this wide is heavy (the super missile's, the mini-nuke's)
const ARMOR_SMALL = 0.1; // an armoured weak point: what lesser hits still do
const ENRAGE_AT = 0.5;

// Attacks (by number: they go online as such).
const A_NONE = 0;
const A_SWAT = 1;
const A_CHARGE = 2;
const A_BEAM = 3;
const A_ROAR = 4;
const A_LASH = 5;
const A_OPEN = 6;
const PHASES = ["walk", "stagger", "falling", "fallen", "rising", "dying", "dead", "leave", "blind"];

let nextId = 1;

// ---------- Hit shapes ----------

// Ray (origin o, unit dir d) against a sphere: the distance, or -1.
function raySphere(o, d, c, r, maxDist) {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc > 0 && b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  return t <= maxDist ? t : -1;
}

// Ray against a capsule (a-b, radius r), approximately: the closest approach
// of the ray to the segment, then back along the ray to the surface.
function rayCapsule(o, d, a, b, r, maxDist) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const wx = o.x - a.x;
  const wy = o.y - a.y;
  const wz = o.z - a.z;
  const uu = ux * ux + uy * uy + uz * uz;
  const ud = ux * d.x + uy * d.y + uz * d.z;
  const uw = ux * wx + uy * wy + uz * wz;
  const dw = d.x * wx + d.y * wy + d.z * wz;
  const den = uu - ud * ud;
  let s = den > 1e-9 ? (ud * dw - uw) / -den : 0;
  // s along the ray: t; along the segment: q (0-1)
  let t = den > 1e-9 ? (uu * dw - ud * uw) / -den : -dw;
  let q = uu > 1e-9 ? (uw + t * ud) / uu : 0;
  q = clamp(q, 0, 1);
  // The point on the segment, then the ray's nearest t to it.
  const px = a.x + ux * q;
  const py = a.y + uy * q;
  const pz = a.z + uz * q;
  t = (px - o.x) * d.x + (py - o.y) * d.y + (pz - o.z) * d.z;
  if (t < 0) t = 0;
  const cx = o.x + d.x * t - px;
  const cy = o.y + d.y * t - py;
  const cz = o.z + d.z * t - pz;
  const dist2 = cx * cx + cy * cy + cz * cz;
  if (dist2 > r * r) return -1;
  t -= Math.sqrt(r * r - dist2);
  if (t < 0) t = 0;
  void s;
  return t <= maxDist ? t : -1;
}

// Distance from p to the segment a-b.
function segDist(p, a, b) {
  _e.subVectors(b, a);
  const l2 = _e.lengthSq();
  const t = l2 > 1e-9 ? clamp(((p.x - a.x) * _e.x + (p.y - a.y) * _e.y + (p.z - a.z) * _e.z) / l2, 0, 1) : 0;
  return Math.hypot(a.x + _e.x * t - p.x, a.y + _e.y * t - p.y, a.z + _e.z * t - p.z);
}

// ---------- A weak point, a plate, the hide: what the weapons see ----------

// A UFO-like object (js/ufos.js raycast/damage, the jets' lock-on): pos,
// radius, state "gone" once destroyed; extDamage gets the hit.
function makePart(col, kind, idx, radius, opts = {}) {
  const w = WEAK[kind];
  const hp = opts.hp ?? w?.hp ?? PLATE_HP;
  const p = {
    col,
    kind,
    idx,
    radius,
    hitHalfHeight: radius,
    pos: V(),
    vel: V(),
    _last: null,
    state: "alive",
    falling: false,
    hp,
    maxHp: hp,
    boss: true,
    bossName: `${col.spec.short.toUpperCase()} ${w?.label || (kind === "plate" ? "ARMOR" : "HIDE")}`,
    hostile: true,
    size: "giant",
    plates: null, // (a weak point under armour: its plates)
    under: null, // (a plate: the weak point it covers)
    mesh: null,
    flash: 0,
    extDamage: (amount, byPlayer, from) => col.mgr._hit(col, p, amount, byPlayer, from),
    ...opts,
  };
  return p;
}

// ---------- The base creature ----------

class Colossus {
  constructor(mgr, kind, o) {
    this.mgr = mgr;
    this.kind = kind;
    this.spec = COLOSSUS_SPEC[kind];
    this.id = o.id ?? nextId++;
    if (this.id >= nextId) nextId = this.id + 1;
    this.seed = o.seed ?? Math.floor(Math.random() * 1e9);
    this.rnd = seeded(this.seed);
    this.root = new THREE.Vector3(o.x, 0, o.z);
    this.root.y = mgr.groundAt(o.x, o.z);
    this.yaw = o.yaw ?? 0;
    this.vel = V();
    this.s = 0; // the distance walked
    this.t = 0;
    this.maxHp = Math.round(this.spec.hp * (o.hpScale ?? 1));
    this.hp = this.maxHp;
    this.phase = "walk";
    this.phaseT = 0;
    this.enraged = false;
    this.goal = o.goal ? new THREE.Vector3(o.goal.x, 0, o.goal.z) : null;
    this.keepAway = o.keepAway ?? 0;
    this.weak = [];
    this.plates = [];
    this.legs = [];
    this.caps = []; // the hide: capsules { a, b, r }
    this.balls = []; // and spheres { c, r }
    this.atk = { code: A_NONE, t: 0, dur: 0, side: 0, aim: V(), n: 0, hit: false, target: null };
    this.cool = { roar: 8, beam: 5, launch: 3, glob: 2, swat: 1, lash: 1, tangle: 0 };
    this.vulnT = 0; // a stumble: the weak points take more
    this.bodyPos = V();
    this.fwd = V();
    this.right = V();
    this.up = V(0, 1, 0);
    this.tilt = { pitch: 0, roll: 0 };
    this.fall = 0; // 0 standing - 1 down
    this.alpha = 1;
    this.sink = 0;
    this.hide = makePart(this, "hide", -1, this.spec.bound, { hp: Infinity });
    this.group = new THREE.Group();
    this.group.name = `colossus-${kind}`;
    mgr.scene.add(this.group);
    this.lod = 0;
    this.blastBudget = 0;
    this.lastHitT = -99;
    this.puppet = !!mgr.puppets;
    this.net = null; // (a guest's puppet: the host's last state)
  }

  get alive() {
    return this.phase !== "dying" && this.phase !== "dead" && this.phase !== "leave";
  }

  get standing() {
    return this.phase === "walk" || this.phase === "stagger" || this.phase === "blind";
  }

  // The body's frame from the yaw and the tilt.
  _frame() {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.fwd.set(-sy, 0, -cy);
    this.right.set(cy, 0, -sy);
    this.up.set(0, 1, 0);
    const { pitch, roll } = this.tilt;
    if (pitch || roll) {
      _q.setFromAxisAngle(this.right, pitch);
      this.fwd.applyQuaternion(_q);
      this.up.applyQuaternion(_q);
      _q.setFromAxisAngle(this.fwd, roll);
      this.right.applyQuaternion(_q);
      this.up.applyQuaternion(_q);
    }
  }

  // A point in the body's frame (x right, y up, z forward) from `o`.
  at(out, o, x, y, z) {
    return out.copy(o).addScaledVector(this.right, x).addScaledVector(this.up, y).addScaledVector(this.fwd, z);
  }

  // A point on the ground in the yaw's frame (no tilt).
  ground(out, x, z) {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    out.set(this.root.x + cy * x - sy * z, 0, this.root.z - sy * x - cy * z);
    out.y = this.mgr.groundAt(out.x, out.z);
    return out;
  }

  // ---------- Legs and stepping (every machine, from the root) ----------

  // A leg: hip (x, y, z in the body frame), home (x, z on the ground), l1, l2, group.
  addLeg(o) {
    const leg = { ...o, foot: V(), from: V(), to: V(), knee: V(), hip: V(), home: V(), swing: -1, dead: false, planted: true };
    this.ground(leg.foot, o.hx, o.hz);
    this.legs.push(leg);
    return leg;
  }

  _gait(dt, speed) {
    const step = this.stepDist;
    const lead = this.stepLead ?? 0.5;
    const swingT = this.swingTime * (this.enraged ? 0.75 : 1);
    const moving = this.standing && speed > 0.05;
    const swinging = [0, 0];
    for (const l of this.legs) if (l.swing >= 0) swinging[l.group]++;
    for (const l of this.legs) {
      const spread = this.phase === "fallen" || this.phase === "falling" || this.phase === "dying" || this.phase === "dead" ? 1.25 : 1;
      this.ground(l.home, l.hx * spread, l.hz * spread);
      if (moving) {
        l.home.addScaledVector(this.vel, lead * swingT);
        l.home.y = this.mgr.groundAt(l.home.x, l.home.z);
      }
      if (l.swing >= 0) {
        l.swing += dt / swingT;
        const u = Math.min(1, l.swing);
        const k = ease(u);
        l.foot.lerpVectors(l.from, l.to, k);
        l.foot.y += Math.sin(Math.PI * u) * this.lift;
        if (u >= 1) {
          l.swing = -1;
          l.foot.copy(l.to);
          this.onFootfall(l);
        }
        continue;
      }
      if (l.dead) {
        // A dead leg drags: its foot is pulled along behind, scraping.
        const dx = l.home.x - l.foot.x;
        const dz = l.home.z - l.foot.z;
        const d = Math.hypot(dx, dz);
        const max = step * 1.6;
        if (d > max) {
          const k = (d - max) / d;
          l.foot.x += dx * k;
          l.foot.z += dz * k;
          l.foot.y = this.mgr.groundAt(l.foot.x, l.foot.z);
          if (Math.random() < dt * 3) this.mgr.dust(l.foot, 0.6, 3);
        }
        continue;
      }
      const d = Math.hypot(l.home.x - l.foot.x, l.home.z - l.foot.z);
      const other = 1 - l.group;
      // (A stride once the home has moved far enough, the other group planted;
      // when standing still, any leg far off its home catches up.)
      const want = d > step || (!moving && d > step * 0.35 && this.phase !== "fallen" && this.phase !== "falling");
      if (want && swinging[other] === 0 && swinging[l.group] < (this.maxSwing ?? 3)) {
        l.swing = 0;
        l.from.copy(l.foot);
        l.to.copy(l.home);
        swinging[l.group]++;
      }
    }
  }

  onFootfall(l) {
    const m = this.mgr;
    m.footfall(this, l.foot, this.footSize ?? 4, this.footShake ?? 0.5);
  }

  // The average height of the planted feet (the body rides on them).
  _feetY() {
    let s = 0;
    let n = 0;
    for (const l of this.legs) {
      if (l.arm) continue;
      s += l.swing >= 0 ? Math.min(l.from.y, l.to.y) : l.foot.y;
      n++;
    }
    return n ? s / n : this.root.y;
  }

  // ---------- The host's brain ----------

  // Where it walks: its goal (a town), or toward the nearest target, keeping `keepAway`.
  _move(dt) {
    let speed = 0;
    let want = null;
    if (this.phase === "walk" || this.phase === "blind") {
      if (this.goal) want = this.goal;
      else {
        const t = this.mgr.nearestTarget(this.root, 4000);
        if (t) {
          _a.set(t.pos.x - this.root.x, 0, t.pos.z - this.root.z);
          if (_a.length() > this.keepAway) want = t.pos;
        }
      }
      if (this.phase === "blind") want = _b.set(this.root.x + Math.sin(this.t * 0.4) * 80, 0, this.root.z + Math.cos(this.t * 0.3) * 80);
    }
    if (want) {
      const dx = want.x - this.root.x;
      const dz = want.z - this.root.z;
      const target = Math.atan2(-dx, -dz);
      let dy = target - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const turn = (this.turnRate ?? 0.12) * dt;
      this.yaw += clamp(dy, -turn, turn);
      // (Only walking when roughly facing it.)
      speed = (this.enraged ? this.spec.rage : this.spec.speed) * clamp(1 - Math.abs(dy) / 1.2, 0, 1) * (this.mgr.speedScale ?? 1) * (this.speedMul ?? 1);
      if (Math.hypot(dx, dz) < 4) speed = 0;
    }
    if (this.atk.code === A_ROAR || (this.atk.code === A_SWAT && this.kind === "weeper")) speed *= 0.3;
    this._frame();
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.vel.set(-sy * speed, 0, -cy * speed);
    this.root.addScaledVector(this.vel, dt);
    this.s += speed * dt;
    this.root.y = this.mgr.groundAt(this.root.x, this.root.z);
    return speed;
  }

  // ---------- Damage (the host; js/ufos.js hands each hit here) ----------

  // The multiplier on a weak point's damage right now (a stumble, a charge).
  mult(p) {
    let k = this.vulnT > 0 ? 2 : 1;
    if (WEAK[p.kind]?.tough && !(this.vulnT > 0)) k *= WEAK[p.kind].tough;
    return k;
  }

  armored(p) {
    return !!p.plates && p.plates.some((q) => q.state !== "gone");
  }

  hit(p, amount, heavy, from) {
    if (!this.alive) return false;
    const m = this.mgr;
    this.lastHitT = m.time;
    if (p.kind === "hide") {
      if (heavy) {
        const q = this._nearestPlate(from || p.pos, 140);
        if (q) this.crack(q);
        this.damageCore(amount * 0.25, true);
        m.spark(from, "hit", 3);
      } else if (amount >= 100) {
        this.damageCore(amount * 0.08, true);
        m.spark(from, "armor", 2);
      } else {
        m.spark(from, "armor", 0.6);
        m.armorNote(this);
      }
      return true;
    }
    if (p.kind === "plate") {
      if (p.state === "gone") return false;
      if (heavy) this.crack(p);
      else if (amount >= 100) {
        p.hp -= amount;
        p.flash = 0.2;
        if (p.hp <= 0) this.crack(p);
        m.spark(from, "armor", 1.5);
      } else {
        m.spark(from, "armor", 0.6);
        m.armorNote(this);
      }
      return true;
    }
    if (p.state === "gone") return false;
    if (this.armored(p)) {
      if (heavy) {
        const q = this._nearestPlate(from || p.pos, 999, p.plates);
        if (q) this.crack(q);
      }
      m.armorNote(this);
      this._damageWeak(p, amount * ARMOR_SMALL);
      m.spark(from, "armor", 1);
      return true;
    }
    this._damageWeak(p, amount * this.mult(p));
    m.spark(from, "hit", 1.2);
    return true;
  }

  _damageWeak(p, dmg) {
    if (dmg <= 0 || p.state === "gone") return;
    const w = WEAK[p.kind];
    dmg = Math.min(dmg, p.hp); // (an overkill reaches the core no further)
    p.hp -= dmg;
    p.flash = 0.25;
    this.damageCore(dmg * (w?.transfer ?? 1));
    if (p.hp <= 0 && this.alive) this.destroyWeak(p);
  }

  _nearestPlate(at, maxD, list = this.plates) {
    let best = null;
    let bd = maxD;
    for (const q of list) {
      if (q.state === "gone") continue;
      const d = q.pos.distanceTo(at);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  crack(q) {
    if (q.state === "gone") return;
    q.state = "gone";
    q.hp = 0;
    this.mgr.onPart(this, q, "crack");
    const left = q.under?.plates?.filter((x) => x.state !== "gone").length ?? 0;
    this.mgr.say(left ? `ARMOR CRACKED: ${left} plate${left === 1 ? "" : "s"} left over the ${WEAK[q.under.kind].label.toLowerCase()}.` : `ARMOR OFF: the ${this.spec.short}'s ${WEAK[q.under?.kind]?.label.toLowerCase() || "weak point"} is open. Hit it with everything!`, 4);
  }

  destroyWeak(p) {
    p.state = "gone";
    p.hp = 0;
    const w = WEAK[p.kind];
    if (w?.bonus) this.damageCore(w.bonus);
    this.mgr.onPart(this, p, "destroy");
    this.onWeakDestroyed(p);
  }

  onWeakDestroyed() {}

  damageCore(n, hide = false) {
    if (!this.alive || n <= 0) return;
    // (A blast's cap: one explosion takes at most its budget off the core.)
    if (this.mgr._inBlast) {
      if (this.blastBudget <= 0) return;
      n = Math.min(n, this.blastBudget);
      this.blastBudget -= n;
    }
    // (The hide alone can't kill it: the weak points must go.)
    const floor = hide ? this.maxHp * 0.08 : 0;
    this.hp = Math.max(floor, this.hp - n);
    if (!this.enraged && this.hp <= this.maxHp * ENRAGE_AT) this.enrage();
    if (this.hp <= 0) this.die();
  }

  enrage() {
    this.enraged = true;
    this.mgr.say(`${this.spec.name} IS ENRAGED: faster, and it hits harder.`, 4);
    this.mgr.onEnrage(this);
    for (const k in this.cool) this.cool[k] = Math.min(this.cool[k], 1.5);
  }

  die() {
    if (!this.alive) return;
    this.hp = 0;
    this.setPhase("dying");
    this.atk.code = A_NONE;
    this.mgr.onDown(this);
  }

  setPhase(ph) {
    if (this.phase === ph) return;
    this.phase = ph;
    this.phaseT = 0;
    if (ph === "falling" || ph === "dying") this._fallFrom = this.fall;
  }

  // Every frame (both sides): time, phases, the walk, the pose.
  update(dt, host) {
    this.t += dt;
    this.phaseT += dt;
    this.vulnT = Math.max(0, this.vulnT - dt);
    for (const p of [...this.weak, ...this.plates]) {
      p.flash = Math.max(0, p.flash - dt);
      if (p._last) p.vel.subVectors(p.pos, p._last).divideScalar(Math.max(1e-3, dt));
      p._last = (p._last || V()).copy(p.pos);
    }
    for (const k in this.cool) this.cool[k] -= dt;
    let speed = 0;
    if (host) {
      if (this.phase === "stagger" && this.phaseT > (this.staggerT ?? 4)) this.setPhase("walk");
      if (this.standing) speed = this._move(dt);
      else {
        this.vel.set(0, 0, 0);
        this._frame();
      }
      this.think(dt);
    } else speed = this._puppetMove(dt);
    // Falling, down, rising, dying.
    if (this.phase === "falling") {
      this.fall = Math.min(1, this._fallFrom + (this.phaseT / 2.6) ** 2);
      if (this.fall >= 1 && host) this.setPhase("fallen");
    } else if (this.phase === "dying") {
      this.fall = Math.min(1, (this._fallFrom ?? 0) + (this.phaseT / 3.2) ** 2);
      if (host && this.phaseT > 6) this.setPhase("dead");
    } else if (this.phase === "fallen") this.fall = 1;
    else if (this.phase === "rising") {
      this.fall = Math.max(0, 1 - this.phaseT / 4);
      if (host && this.phaseT > 4) this.setPhase("walk");
    } else if (this.phase === "dead") this.fall = 1;
    else if (this.phase !== "leave") this.fall = Math.max(0, this.fall - dt * 0.5);
    if ((this.phase === "falling" || this.phase === "dying") && !this._thudDone && this.fall >= 0.98) {
      this._thudDone = true;
      this.mgr.collapse(this);
    }
    if (this.phase === "walk" || this.phase === "rising") this._thudDone = false;
    if (this.phase === "dead") this.sink = Math.max(0, this.phaseT - 30) * 3;
    if (this.phase === "leave") this.sink += dt * 12;
    this.animAttack(dt, host);
    this._gait(dt, speed);
    this.pose(dt);
    this._placeParts();
  }

  // A guest: the host's root, eased in; the walk's speed from it.
  _puppetMove(dt) {
    const n = this.net;
    if (!n) return 0;
    const k = 1 - Math.exp(-dt * 5);
    const ox = this.root.x;
    const oz = this.root.z;
    this.root.x = lerp(this.root.x, n.x, k);
    this.root.z = lerp(this.root.z, n.z, k);
    // (Far off, or a first state: there at once.)
    if (Math.hypot(n.x - this.root.x, n.z - this.root.z) > 60) {
      this.root.x = n.x;
      this.root.z = n.z;
    }
    this.root.y = this.mgr.groundAt(this.root.x, this.root.z);
    let dy = n.yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k;
    this._frame();
    this.vel.set((this.root.x - ox) / Math.max(1e-3, dt), 0, (this.root.z - oz) / Math.max(1e-3, dt));
    return Math.hypot(this.vel.x, this.vel.z);
  }

  // The weak points' and plates' glowing meshes follow their parts.
  _placeParts() {
    const M = colossusMaterials();
    for (const p of this.weak) {
      const g = p.mesh;
      if (!g) continue;
      const gone = p.state === "gone";
      const hot = !gone && this.isHot(p);
      g.material = gone || !this.alive ? M.dead : hot ? M.hot : M.glow[WEAK[p.kind].glow];
      const pulse = 1 + 0.08 * Math.sin(this.t * 3 + p.idx) + p.flash * 1.2 + (hot ? 0.2 * Math.sin(this.t * 25) : 0);
      g.position.copy(p.pos);
      g.scale.setScalar((p.glowR ?? p.radius * 0.55) * (gone ? 0.7 : pulse));
    }
    for (const q of this.plates) {
      const g = q.mesh;
      if (!g) continue;
      g.material = q.state === "gone" ? M.cracked : M.plate;
      g.position.copy(q.pos);
      _a.subVectors(q.pos, q.under?.pos || this.bodyPos).normalize();
      g.quaternion.setFromUnitVectors(_b.set(0, 0, 1), _a);
      const s = q.radius * (q.state === "gone" ? 0.75 : 1);
      g.scale.set(s, s, s * (q.state === "gone" ? 0.5 : 1));
      if (q.state === "gone") g.position.addScaledVector(_a, 2);
    }
    // The haze: the hide toward the horizon's colour, far off.
    this.group.position.y = -this.sink;
  }

  // Is weak point p open to triple damage right now? (its own rules)
  isHot() {
    return false;
  }

  // ---------- Attacks (the kind's own) ----------
  think() {}
  animAttack() {}
  pose() {}

  startAttack(code, dur, side = 0, aim = null, target = null) {
    const a = this.atk;
    a.code = code;
    a.t = 0;
    a.dur = dur;
    a.side = side;
    a.hit = false;
    a.started = false;
    a.n = (a.n + 1) % 1000;
    a.target = target;
    if (aim) a.aim.copy(aim);
    this.mgr.onAttack(this, code);
  }

  endAttack() {
    this.atk.code = A_NONE;
    this.atk.t = 0;
    this.atk.target = null;
  }

  dispose() {
    this.mgr.scene.remove(this.group);
    for (const p of [...this.weak, ...this.plates, this.hide]) p.state = "gone";
  }
}

// ---------- THE STRIDER ----------

const STRIDER_LEGS = [35, 90, 145, -35, -90, -145];

class Strider extends Colossus {
  constructor(mgr, o) {
    super(mgr, "strider", o);
    this.bodyH = 140;
    this.stepDist = 50;
    this.swingTime = 2.4;
    this.stepLead = 0.55;
    this.lift = 24;
    this.maxSwing = 3;
    this.footSize = 3.6;
    this.footShake = 0.55;
    this.turnRate = 0.1;
    this.staggerT = 5;
    const M = colossusMaterials();
    const g = this.group;
    const hide = M.hide.strider;
    this.bodyG = new THREE.Group();
    g.add(this.bodyG);
    this.body = new THREE.Mesh(lumpyGeometry(this.seed, 15, 8, 19, 0.16), M.body.strider);
    this.bodyG.add(this.body);
    // Spines along its back, crooked.
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(spikeGeometry(), hide);
      const z = -14 + i * 3.5;
      s.position.set((this.rnd() - 0.5) * 6, 6 + Math.sin(i) * 1.5, z);
      s.rotation.set(-0.5 + this.rnd() * 0.3, 0, (this.rnd() - 0.5) * 0.8);
      s.scale.set(1.3, 6 + this.rnd() * 7, 1.3);
      this.bodyG.add(s);
    }
    STRIDER_LEGS.forEach((deg, i) => {
      const a = (deg * Math.PI) / 180;
      const leg = this.addLeg({ hx: Math.sin(a) * 95, hz: Math.cos(a) * 95, ax: Math.sin(a) * 10, az: Math.cos(a) * 12, l1: 92, l2: 158, group: i % 2, i });
      leg.thigh = makeLimb(g, hide, 0.6);
      leg.shin = makeLimb(g, hide, 0.22);
      leg.knob = makeBall(g, hide);
      leg.claw = new THREE.Mesh(spikeGeometry(), hide);
      g.add(leg.claw);
      const p = makePart(this, "knee", i, 6.5, { glowR: 3.4 });
      p.mesh = makeBall(g, M.glow.joint);
      p.leg = leg;
      leg.part = p;
      this.weak.push(p);
    });
    // The sac under the body: a stalk, the glowing sac, its eyes, three plates.
    this.stalk = makeLimb(g, hide, 0.5);
    const sac = makePart(this, "sac", 6, 9, { glowR: 7 });
    sac.mesh = makeBall(g, M.glow.sac);
    this.sac = sac;
    this.weak.push(sac);
    this.sacEyes = [];
    for (let i = 0; i < 6; i++) {
      const e = makeBall(g, M.glow.eye);
      e.userData.dir = new THREE.Vector3(Math.cos(i * 1.05) * 0.8, -0.3 - (i % 2) * 0.3, Math.sin(i * 1.05) * 0.8).normalize();
      this.sacEyes.push(e);
    }
    sac.plates = [];
    for (let i = 0; i < 3; i++) {
      const q = makePart(this, "plate", 10 + i, 7.5, { under: sac });
      q.mesh = new THREE.Mesh(plateGeometry(), M.plate);
      g.add(q.mesh);
      q.dir = new THREE.Vector3(Math.cos((i * Math.PI * 2) / 3), 0.15, Math.sin((i * Math.PI * 2) / 3)).normalize();
      sac.plates.push(q);
      this.plates.push(q);
    }
    // Four tendrils hanging from the belly (7 segments each).
    this.tendrils = [];
    for (let i = 0; i < 4; i++) {
      const segs = [];
      for (let k = 0; k < 7; k++) segs.push(makeLimb(g, hide, 0.72));
      const tip = makeBall(g, M.glow.joint);
      this.tendrils.push({ segs, tip, pts: Array.from({ length: 8 }, V), ang: (i / 4) * Math.PI * 2 + 0.4 });
    }
    this.sacPos = V();
    this.sacSwing = { x: 0, z: 0, vx: 0, vz: 0 };
  }

  isHot(p) {
    return this.vulnT > 0 && p.kind === "knee";
  }

  onWeakDestroyed(p) {
    if (p.kind === "knee") {
      p.leg.dead = true;
      const dead = this.legs.filter((l) => l.dead).length;
      if (dead >= 3 && this.standing) {
        this.setPhase("falling");
        this.endAttack();
        this.mgr.say(`THE STRIDER IS FALLING! The fall splits its shell: hit the sac!`, 5);
      } else this.mgr.say(`KNEE DESTROYED (${dead}/3 to bring it down). It limps on.`, 3.5);
    } else if (p.kind === "sac") this.die();
  }

  think(dt) {
    const m = this.mgr;
    // Fallen: it tries to get up after a while (two legs half healed).
    if (this.phase === "fallen") {
      // (The shell is split while it lies there: the sac's plates are off.)
      for (const q of this.sac.plates) if (q.state !== "gone") this.crack(q);
      if (this.phaseT > 38) {
        const dead = this.legs.filter((l) => l.dead).sort((a, b) => a.i - b.i);
        for (const l of dead.slice(0, 2)) {
          l.dead = false;
          l.part.state = "alive";
          l.part.hp = l.part.maxHp * 0.35;
        }
        this.setPhase("rising");
        m.say("The Strider is getting up again!", 4);
      }
      return;
    }
    if (!this.standing || this.phase === "stagger") return;
    // Flying between its legs: it stumbles trying to follow.
    if ((this.cool.tangle ?? 0) <= 0) {
      for (const t of m.targetList()) {
        if (!t.air) continue;
        const h = Math.hypot(t.pos.x - this.bodyPos.x, t.pos.z - this.bodyPos.z);
        if (h < 62 && t.pos.y < this.bodyPos.y - 6 && t.pos.y > this.root.y) {
          this.cool.tangle = 25;
          this.vulnT = 6;
          this.setPhase("stagger");
          this.endAttack();
          m.say("It stumbles trying to follow you between its legs! Its knees are exposed: x2 damage!", 4);
          m.onEvent?.("tangle", this);
          return;
        }
      }
    }
    if (this.atk.code !== A_NONE) {
      if (this.atk.t >= this.atk.dur) this.endAttack();
      return;
    }
    // Tendril lash: an aircraft close to the body.
    const near = m.nearestTarget(this.bodyPos, this.enraged ? 125 : 95, true);
    if (near && (this.cool.lash ?? 0) <= 0) {
      this.cool.lash = this.enraged ? 3 : 4.5;
      this.startAttack(A_LASH, 1.35, 0, near.pos, near);
      return;
    }
    // Acid globs from the sac at aircraft in range.
    const t = m.nearestTarget(this.sacPos, 750, true);
    if (t && (this.cool.glob ?? 0) <= 0) {
      this.cool.glob = this.enraged ? 2.2 : 3.4;
      m.spitGlobs(this, this.sacPos, t, this.enraged ? 5 : 3, 175);
    }
  }

  animAttack(dt) {
    const a = this.atk;
    if (a.code === A_NONE) return;
    a.t += dt;
    if (a.code === A_LASH) {
      // Wind-up 0.9 s, then the strike: a hit when an aircraft is by a tendril's tip.
      if (!a.hit && a.t > 0.9 && a.t < 1.3) {
        for (const tn of this.tendrils) {
          const tip = tn.pts[tn.pts.length - 1];
          const lt = this.mgr.localTarget();
          if (lt && lt.air && segDist(lt.pos, tn.pts[3], tip) < 13) {
            a.hit = true;
            this.mgr.hurtLocal(lt, this.enraged ? 55 : 40, "colossus", _a.subVectors(lt.pos, this.bodyPos).normalize().multiplyScalar(40));
            this.mgr.say("Lashed by a tendril!", 2, true);
            break;
          }
        }
      }
    }
  }

  pose(dt) {
    const down = this.fall;
    const deadN = this.legs.filter((l) => l.dead).length;
    // Tilt toward the dead legs, a heavy sway while stumbling.
    let tx = 0;
    let tz = 0;
    for (const l of this.legs) if (l.dead) {
      tx += l.hx;
      tz += l.hz;
    }
    const stag = this.phase === "stagger" ? Math.sin(this.phaseT * 3.1) * 0.12 : 0;
    this.tilt.roll = lerp(this.tilt.roll, clamp(tx / 400, -0.3, 0.3) + stag, Math.min(1, dt * 1.5));
    this.tilt.pitch = lerp(this.tilt.pitch, clamp(-tz / 400, -0.3, 0.3) + stag * 0.5, Math.min(1, dt * 1.5));
    this._frame();
    const standY = this._feetY() + this.bodyH - deadN * 10 + Math.sin(this.s * 0.12) * 1.5 + Math.sin(this.t * 0.9) * 0.8;
    const lowY = this.root.y + 9;
    this.bodyPos.set(this.root.x, lerp(standY, lowY, down), this.root.z);
    _m.makeBasis(this.right, this.up, _c.copy(this.fwd).negate());
    this.bodyG.position.copy(this.bodyPos);
    this.bodyG.quaternion.setFromRotationMatrix(_m);
    this.caps.length = 0;
    this.balls.length = 0;
    this.balls.push({ c: this.bodyPos, r: 15 });
    for (const l of this.legs) {
      this.at(l.hip, this.bodyPos, l.ax, -2, l.az);
      // The pole: out and up (the knee high over the body); a dead leg's sags.
      _a.set(l.hip.x - this.bodyPos.x, 0, l.hip.z - this.bodyPos.z).normalize();
      const pole = _b.copy(_a).multiplyScalar(0.55).addScaledVector(UPV, l.dead || down > 0.5 ? -0.4 : 1).normalize();
      solveKnee(l.hip, l.foot, l.l1, l.l2, pole, l.knee);
      placeLimb(l.thigh, l.hip, l.knee, 2.6);
      placeLimb(l.shin, l.knee, l.foot, 1.75);
      l.knob.position.copy(l.knee);
      l.knob.scale.setScalar(4.4);
      placeLimb(l.claw, _c.copy(l.foot).addScaledVector(UPV, 9), l.foot, 1.6);
      l.part.pos.copy(l.knee);
      this.caps.push({ a: l.hip, b: l.knee, r: 2.6 }, { a: l.knee, b: l.foot, r: 1.8 });
    }
    // The sac swings under the body like a pendulum (pushed by the walk).
    const sw = this.sacSwing;
    sw.vx += (-sw.x * 0.9 - this.vel.x * 0.006) * dt;
    sw.vz += (-sw.z * 0.9 - this.vel.z * 0.006) * dt;
    sw.vx *= 1 - dt * 0.3;
    sw.vz *= 1 - dt * 0.3;
    sw.x = clamp(sw.x + sw.vx * dt, -0.6, 0.6);
    sw.z = clamp(sw.z + sw.vz * dt, -0.6, 0.6);
    const pivot = this.at(_a, this.bodyPos, 0, -7, 0).clone();
    const len = lerp(30, 6, down);
    _b.set(Math.sin(sw.x + Math.sin(this.t * 0.7) * 0.08), -1, Math.sin(sw.z)).normalize();
    this.sacPos.copy(pivot).addScaledVector(_b, len);
    if (down > 0.5) this.sacPos.y = Math.max(this.sacPos.y, this.root.y + 7);
    placeLimb(this.stalk, pivot, this.sacPos, 2.2);
    this.sac.pos.copy(this.sacPos);
    for (const e of this.sacEyes) {
      e.position.copy(this.sacPos).addScaledVector(e.userData.dir, 7.2);
      e.scale.setScalar(this.sac.state === "gone" ? 0.6 : 1.3 + 0.3 * Math.sin(this.t * 2 + e.id));
      e.material = this.sac.state === "gone" ? colossusMaterials().dead : colossusMaterials().glow.eye;
    }
    for (const q of this.plates) q.pos.copy(this.sacPos).addScaledVector(q.dir, 8.2);
    this.caps.push({ a: pivot, b: this.sacPos, r: 2.4 });
    // Tendrils: hanging and swaying; during a lash they curl back, then whip at the aim.
    const a = this.atk;
    const lashing = a.code === A_LASH;
    for (const tn of this.tendrils) {
      this.at(tn.pts[0], this.bodyPos, Math.cos(tn.ang) * 7, -5, Math.sin(tn.ang) * 9);
      let dir = _c.set(Math.sin(this.t * 0.6 + tn.ang) * 0.25, -1, Math.cos(this.t * 0.5 + tn.ang) * 0.25).normalize();
      if (lashing) {
        _d.subVectors(a.aim, tn.pts[0]).normalize();
        if (a.t < 0.9) dir.lerp(_e.copy(_d).negate().add(UPV).normalize(), ease(a.t / 0.9)).normalize();
        else dir.copy(_d);
      }
      for (let k = 1; k < tn.pts.length; k++) {
        const wob = Math.sin(this.t * 2.3 + k * 0.8 + tn.ang) * 0.18 * (lashing ? 0.2 : 1);
        _e.copy(dir).add(_d.set(wob, 0, -wob)).normalize();
        tn.pts[k].copy(tn.pts[k - 1]).addScaledVector(_e, lashing && a.t > 0.9 ? 12 : 7.5);
        if (down > 0.5) tn.pts[k].y = Math.max(tn.pts[k].y, this.root.y + 1);
        placeLimb(tn.segs[k - 1], tn.pts[k - 1], tn.pts[k], 1.1 * (1 - k / 9));
      }
      tn.tip.position.copy(tn.pts[tn.pts.length - 1]);
      tn.tip.scale.setScalar(lashing && a.t < 0.9 ? 1.6 : 0.8);
    }
  }
}

// ---------- THE WATCHER ----------

class Weeper extends Colossus {
  constructor(mgr, o) {
    super(mgr, "weeper", o);
    this.hipH = 98;
    this.stepDist = 34;
    this.swingTime = 1.9;
    this.stepLead = 0.5;
    this.lift = 12;
    this.maxSwing = 2;
    this.footSize = 5;
    this.footShake = 0.5;
    this.turnRate = 0.16;
    this.staggerT = 4;
    this.keepAway = o.keepAway ?? 230;
    const M = colossusMaterials();
    const g = this.group;
    const hide = M.hide.weeper;
    this.rear = 0; // 0 hunched - 1 rearing up (the screech)
    // Legs (group 0/1) and arms walking on their knuckles (the other group).
    for (const side of [-1, 1]) {
      const leg = this.addLeg({ hx: side * 18, hz: -6, ax: side * 12, l1: 57, l2: 57, group: side < 0 ? 0 : 1 });
      leg.thigh = makeLimb(g, hide, 0.62);
      leg.shin = makeLimb(g, hide, 0.42);
      leg.knob = makeBall(g, hide);
      leg.foot2 = makeBall(g, hide);
    }
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = this.addLeg({ hx: side * 36, hz: 64, ax: side * 17, l1: 76, l2: 82, group: side < 0 ? 1 : 0, arm: true, side });
      arm.upper = makeLimb(g, hide, 0.55);
      arm.fore = makeLimb(g, hide, 0.45);
      arm.knob = makeBall(g, hide);
      arm.fingers = [];
      for (let f = 0; f < 4; f++) arm.fingers.push([makeLimb(g, hide, 0.6), makeLimb(g, hide, 0.3)]);
      const p = makePart(this, "wrist", side < 0 ? 0 : 1, 5.5, { glowR: 2.8 });
      p.mesh = makeBall(g, M.glow.wrist);
      p.arm = arm;
      arm.part = p;
      this.weak.push(p);
      this.arms.push(arm);
      arm.hand = V();
      arm.stuckT = 0;
    }
    // The spine (6 bones), the ribs, the pelvis.
    this.spine = [];
    for (let i = 0; i < 6; i++) this.spine.push(makeLimb(g, hide, 0.8));
    this.spinePts = Array.from({ length: 7 }, V);
    this.ribs = [];
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) {
      const r = new THREE.Mesh(ribGeometry(side), M.bone);
      g.add(r);
      this.ribs.push({ m: r, i, side });
    }
    this.pelvis = makeBall(g, hide);
    this.neck = [makeLimb(g, hide, 0.7), makeLimb(g, hide, 0.7)];
    this.headG = new THREE.Group();
    g.add(this.headG);
    this.skull = new THREE.Mesh(lumpyGeometry(this.seed, 7, 8, 13, 0.1, 16), M.body.weeper);
    this.headG.add(this.skull);
    this.jaw = new THREE.Mesh(spikeGeometry(), M.bone);
    this.jaw.position.set(0, -7, -6);
    this.jaw.rotation.x = -1.9;
    this.jaw.scale.set(4, 12, 2.5);
    this.headG.add(this.jaw);
    // Seven eyes, a crooked cluster on the face (head frame: -Z forward).
    const eyeAt = [[0, 2.5], [-3.4, 1.2], [3.2, 1.6], [-1.6, -1.2], [1.9, -0.9], [-4, -2.8], [4.2, -2.4]];
    this.eyeLocal = eyeAt.map(([x, y]) => new THREE.Vector3(x, y + 1, -11.5 + Math.abs(x) * 0.35));
    eyeAt.forEach((_, i) => {
      const p = makePart(this, "eye", 2 + i, 3.4, { glowR: 1.7 });
      p.mesh = makeBall(g, M.glow.eye);
      this.weak.push(p);
    });
    this.eyes = this.weak.filter((p) => p.kind === "eye");
    // The heart behind two chest plates.
    const heart = makePart(this, "heart", 9, 7, { glowR: 5 });
    heart.mesh = makeBall(g, M.glow.heart);
    heart.plates = [];
    this.heart = heart;
    this.weak.push(heart);
    for (let i = 0; i < 2; i++) {
      const q = makePart(this, "plate", 10 + i, 9, { under: heart, side: i ? 1 : -1 });
      q.mesh = new THREE.Mesh(plateGeometry(), M.plate);
      g.add(q.mesh);
      heart.plates.push(q);
      this.plates.push(q);
    }
    this.headDir = V(0, 0, -1);
    this.headPos = V();
    this.chest = V();
    this.beamEnd = V();
    this.beamFrom = V();
    this.beamMesh = null;
  }

  isHot(p) {
    const a = this.atk;
    if (p.kind === "eye") return a.code === A_CHARGE || this.vulnT > 0;
    if (p.kind === "wrist") return p.arm.stuckT > 0;
    return false;
  }

  mult(p) {
    if (p.kind === "eye" && this.atk.code === A_CHARGE) return 3;
    if (p.kind === "wrist" && p.arm.stuckT > 0) return 3;
    return super.mult(p);
  }

  onWeakDestroyed(p) {
    const m = this.mgr;
    if (p.kind === "eye") {
      const left = this.eyes.filter((e) => e.state !== "gone").length;
      m.onEvent?.("eye", this);
      if (this.atk.code === A_CHARGE) {
        this.endAttack();
        this.setPhase("stagger");
        this.vulnT = 4;
        m.say("THE BEAM BACKFIRES! It reels: hit the eyes!", 4);
      }
      if (left === 0) {
        m.say("BLINDED! The Watcher thrashes about blindly...", 5);
        m.onEvent?.("blind", this);
        this.setPhase("blind");
        this.endAttack();
      } else m.say(`EYE PUT OUT: ${left} left.`, 2.5);
    } else if (p.kind === "wrist") {
      p.arm.dead = true;
      m.say("Its wrist nerve is cut: that arm hangs limp!", 3.5);
    } else if (p.kind === "heart") this.die();
  }

  think(dt) {
    const m = this.mgr;
    if (this.phase === "blind") {
      if (this.phaseT > 7) this.die();
      // Swats at nothing now and then.
      if (this.atk.code === A_NONE && Math.random() < dt * 0.5) {
        const arm = this.arms.find((x) => !x.dead);
        if (arm) this.startAttack(A_SWAT, 1.8, this.arms.indexOf(arm), this.at(_a, this.bodyPos, arm.side * 60, 40 + Math.random() * 60, 90), null);
      } else if (this.atk.code !== A_NONE && this.atk.t >= this.atk.dur) this.endAttack();
      return;
    }
    if (!this.standing || this.phase === "stagger") return;
    const a = this.atk;
    if (a.code !== A_NONE) {
      if (a.code === A_CHARGE && a.t >= a.dur) {
        // The charge done: the beam fires along where it was looking.
        const t = a.target;
        this.startAttack(A_BEAM, 2.8, 0, a.aim, t);
        return;
      }
      if (a.t >= a.dur) this.endAttack();
      return;
    }
    const sh = this.at(_c, this.bodyPos, 0, 0, 0);
    // The screech: aircraft near (engines stall).
    const near = m.nearestTarget(this.headPos, 420, true);
    if (near && (this.cool.roar ?? 8) <= 0) {
      this.cool.roar = this.enraged ? 14 : 22;
      this.startAttack(A_ROAR, 2.4, 0, near.pos, near);
      return;
    }
    // A swat: an aircraft in an arm's reach.
    const reach = m.nearestTarget(this.headPos, 190, true);
    if (reach && (this.cool.swat ?? 0) <= 0) {
      let best = -1;
      let bd = Infinity;
      this.arms.forEach((arm, i) => {
        if (arm.dead || arm.stuckT > 0) return;
        const d = this.at(_d, this.bodyPos, arm.side * 17, 0, 0).distanceTo(reach.pos);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) {
        this.cool.swat = this.enraged ? 2.2 : 3.6;
        // Aimed where the aircraft will be at the strike.
        _a.copy(reach.pos).addScaledVector(reach.vel || UPV.clone().set(0, 0, 0), 1.4);
        this.startAttack(A_SWAT, 1.9, best, _a, reach);
        return;
      }
    }
    // The eye beam: charge, then sweep.
    const far = m.nearestTarget(this.headPos, 950, true) || m.nearestTarget(this.headPos, 300, false);
    if (far && (this.cool.beam ?? 4) <= 0 && this.eyes.some((e) => e.state !== "gone")) {
      this.cool.beam = this.enraged ? 8 : 11;
      this.startAttack(A_CHARGE, 2.6, 0, far.pos, far);
    }
    void sh;
  }

  // The swat's hand: wind-up (0-1.1 s), the strike (1.1-1.8 s), the return.
  _swatHand(arm, a, out) {
    const sh = this.at(_e, this.bodyPos, arm.side * 17, 0, 0);
    const up = _d.copy(sh).addScaledVector(UPV, 70).addScaledVector(this.right, arm.side * 40).addScaledVector(this.fwd, -15);
    // (Out of reach: the hand stops at the arm's length.)
    const aim = _c.copy(a.aim);
    const reach = arm.l1 + arm.l2 - 4;
    if (aim.distanceTo(sh) > reach) aim.sub(sh).setLength(reach).add(sh);
    if (a.t < 1.1) return out.copy(arm.rest || sh).lerp(up, ease(a.t / 1.1));
    const u = clamp((a.t - 1.1) / 0.6, 0, 1);
    // Through the aim and on (a sweep past it).
    const through = _b.copy(aim).sub(up).multiplyScalar(1.5).add(up);
    if (through.distanceTo(sh) > reach) through.sub(sh).setLength(reach).add(sh);
    return out.copy(up).lerp(through, ease(u));
  }

  animAttack(dt, host) {
    const a = this.atk;
    const m = this.mgr;
    for (const arm of this.arms) arm.stuckT = Math.max(0, arm.stuckT - dt);
    // The rear-up while screeching.
    this.rear = lerp(this.rear, a.code === A_ROAR ? 1 : 0, Math.min(1, dt * 2.5));
    if (a.code === A_NONE) {
      m.beamOff(this);
      return;
    }
    a.t += dt;
    if (a.code === A_SWAT) {
      const arm = this.arms[a.side];
      if (!arm || arm.dead) return;
      if (arm.stuckT > 0) return;
      const hand = this._swatHand(arm, a, _a);
      // The ground: the hand slams into it and sticks.
      const gy = m.groundAt(hand.x, hand.z) + 3;
      if (a.t > 1.1 && hand.y <= gy && !a.hit) {
        a.hit = true;
        hand.y = gy;
        arm.stuckT = 5;
        arm.stuckAt = hand.clone();
        if (host) {
          this.vulnT = Math.max(this.vulnT, 5);
          m.say("ITS HAND IS STUCK IN THE GROUND! Its wrist is open (x3), and its eyes too!", 4);
          m.onEvent?.("stuck", this);
        }
        m.slam(hand, 6);
      }
      arm.swatHand = hand.clone();
      if (a.t > 1.1 && a.t < 1.8 && !a.hit) {
        const lt = m.localTarget();
        if (lt && lt.air && lt.pos.distanceTo(hand) < 17) {
          a.hit = true;
          _b.subVectors(a.aim, this.at(_c, this.bodyPos, arm.side * 17, 0, 0)).normalize().multiplyScalar(60);
          m.hurtLocal(lt, this.enraged ? 85 : 65, "colossus", _b);
          m.say("SWATTED!", 2, true);
          m.shake(0.8);
        }
      }
    } else if (a.code === A_CHARGE) {
      if (!a.started) m.audioFx.charge(m.dist(this.headPos), Math.max(0.3, a.dur - a.t));
      // The eyes follow the target while charging.
      if (host && a.target) a.aim.lerp(a.target.pos, Math.min(1, dt * 2));
    } else if (a.code === A_BEAM) {
      // The beam tracks its target, slowly (a tight turn escapes it).
      if (host && a.target) {
        const from = this.headPos;
        _a.subVectors(a.aim, from).normalize();
        _b.subVectors(a.target.pos, from).normalize();
        const ang = _a.angleTo(_b);
        const max = (this.enraged ? 0.62 : 0.42) * dt;
        if (ang > 1e-4) {
          const k = Math.min(1, max / ang);
          _a.lerp(_b, k).normalize();
        }
        a.aim.copy(from).addScaledVector(_a, Math.max(200, a.target.pos.distanceTo(from)));
      }
      m.beam(this, this.headPos, a.aim, dt);
    } else if (a.code === A_ROAR) {
      if (!a.started) m.roar(this, this.headPos, 340);
    }
    a.started = true;
  }

  pose(dt) {
    const down = this.fall;
    const a = this.atk;
    this.tilt.pitch = lerp(this.tilt.pitch, down * -1.1, Math.min(1, dt * 2));
    this._frame();
    _m.makeBasis(this.right, this.up, _c.copy(this.fwd).negate());
    // The pelvis on the legs (lower while bent, down when fallen).
    const legs = this.legs.filter((l) => !l.arm);
    const fy = legs.reduce((s, l) => s + (l.swing >= 0 ? Math.min(l.from.y, l.to.y) : l.foot.y), 0) / legs.length;
    const P = this.bodyPos.set(this.root.x, lerp(fy + this.hipH + Math.sin(this.s * 0.18) * 1.5, this.root.y + 14, down), this.root.z);
    this.pelvis.position.copy(P);
    this.pelvis.scale.set(14, 8, 10);
    this.pelvis.quaternion.setFromRotationMatrix(_m);
    // The spine: from the pelvis, up and hunched forward (rearing: upright).
    const r = this.rear;
    const S = this.at(_a, P, 0, lerp(70, 104, r), lerp(44, 14, r));
    const C1 = this.at(_b, P, 0, lerp(56, 60, r), lerp(-6, -4, r));
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const p = this.spinePts[i];
      p.copy(P).multiplyScalar((1 - u) * (1 - u)).addScaledVector(C1, 2 * u * (1 - u)).addScaledVector(S, u * u);
      p.addScaledVector(this.right, Math.sin(this.t * 0.7 + u * 3) * 1.2);
    }
    for (let i = 0; i < 6; i++) placeLimb(this.spine[i], this.spinePts[i], this.spinePts[i + 1], 5.5 - i * 0.4);
    this.caps.length = 0;
    this.balls.length = 0;
    this.balls.push({ c: P, r: 13 });
    for (let i = 0; i < 6; i += 2) this.caps.push({ a: this.spinePts[i], b: this.spinePts[i + 2], r: 8 });
    // The ribs round spine points 2-5; the chest in front of them.
    for (const rb of this.ribs) {
      const sp = this.spinePts[1 + rb.i];
      const nx = this.spinePts[2 + rb.i];
      _c.subVectors(nx, sp).normalize();
      // The arc's plane: the spine's direction and the side; open toward the front.
      _d.copy(this.fwd).addScaledVector(_c, -this.fwd.dot(_c)).normalize();
      _e.crossVectors(_d, _c).normalize();
      _m.makeBasis(_e, _d, _c);
      rb.m.quaternion.setFromRotationMatrix(_m);
      const s = 13 - Math.abs(rb.i - 2) * 1.5;
      rb.m.position.copy(sp).addScaledVector(_d, s * 0.92);
      rb.m.scale.set(s, s * 0.9, s);
    }
    this._frame();
    _m.makeBasis(this.right, this.up, _c.copy(this.fwd).negate());
    this.chest.copy(this.spinePts[3]).addScaledVector(this.fwd, 6);
    this.heart.pos.copy(this.chest).addScaledVector(this.fwd, 2);
    for (const q of this.heart.plates) q.pos.copy(this.chest).addScaledVector(this.fwd, 10).addScaledVector(this.right, q.side * 6).addScaledVector(this.up, 2);
    // The neck and the head, looking at what it hunts.
    const top = this.spinePts[6];
    const n1 = this.at(_d, top, 0, 5, 9).clone();
    placeLimb(this.neck[0], top, n1, 3.6);
    let look = null;
    if (a.code === A_BEAM || a.code === A_CHARGE || a.code === A_ROAR) look = a.aim;
    else {
      const t = this.mgr.nearestTarget(top, 1500);
      if (t) look = t.pos;
    }
    if (this.phase === "blind") look = _e.copy(top).addScaledVector(this.fwd, 50).add(_c.set(Math.sin(this.t * 3) * 40, Math.sin(this.t * 2.3) * 30, 0));
    if (down > 0.3) look = null;
    const want = look ? _c.subVectors(look, n1).normalize() : _c.copy(this.fwd).addScaledVector(UPV, -0.35).normalize();
    // (Within its neck's reach of forward.)
    if (want.dot(this.fwd) < 0.1) want.addScaledVector(this.fwd, 0.6).normalize();
    this.headDir.lerp(want, Math.min(1, dt * (this.phase === "blind" ? 6 : 2.2))).normalize();
    this.headPos.copy(n1).addScaledVector(this.headDir, 14);
    placeLimb(this.neck[1], n1, this.headPos, 3);
    this.headG.position.copy(this.headPos);
    _d.crossVectors(UPV, _e.copy(this.headDir).negate()).normalize();
    if (_d.lengthSq() < 1e-6) _d.copy(this.right);
    _c.crossVectors(_e, _d).normalize();
    _m.makeBasis(_d, _c, _e);
    this.headG.quaternion.setFromRotationMatrix(_m);
    this.balls.push({ c: this.headPos, r: 10 });
    for (let i = 0; i < this.eyes.length; i++) this.eyes[i].pos.copy(this.eyeLocal[i]).applyMatrix4(_m.setPosition(this.headPos));
    // The legs.
    for (const l of legs) {
      this.at(l.hip, P, l.ax, -3, 0);
      _a.copy(this.fwd).addScaledVector(this.right, l.hx > 0 ? 0.25 : -0.25).normalize();
      solveKnee(l.hip, l.foot, l.l1, l.l2, _a, l.knee);
      placeLimb(l.thigh, l.hip, l.knee, 5);
      placeLimb(l.shin, l.knee, l.foot, 3.2);
      l.knob.position.copy(l.knee);
      l.knob.scale.setScalar(5.5);
      l.foot2.position.copy(l.foot);
      l.foot2.scale.set(5, 2.5, 8);
      this.caps.push({ a: l.hip, b: l.knee, r: 5 }, { a: l.knee, b: l.foot, r: 3.5 });
    }
    // The arms: on the knuckles, or swatting, or limp, or stuck.
    for (const arm of this.arms) {
      const sh = this.at(_a, this.spinePts[6], arm.side * 17, -4, 0).clone();
      arm.rest = arm.foot;
      let hand = arm.foot;
      if (arm.stuckT > 0 && arm.stuckAt) hand = arm.stuckAt;
      else if (a.code === A_SWAT && this.arms[a.side] === arm && !arm.dead && arm.swatHand) hand = arm.swatHand;
      else if (arm.dead) hand = _b.copy(sh).addScaledVector(UPV, -(arm.l1 + arm.l2) * 0.92).addScaledVector(this.right, arm.side * 8);
      arm.hand.copy(hand);
      if (down > 0.5) arm.hand.y = Math.max(arm.hand.y, this.root.y + 2);
      const pole = _c.copy(this.right).multiplyScalar(arm.side).addScaledVector(this.fwd, -0.5).addScaledVector(UPV, 0.4).normalize();
      solveKnee(sh, arm.hand, arm.l1, arm.l2, pole, arm.knee);
      placeLimb(arm.upper, sh, arm.knee, 4);
      placeLimb(arm.fore, arm.knee, arm.hand, 3);
      arm.knob.position.copy(arm.knee);
      arm.knob.scale.setScalar(4.2);
      arm.part.pos.lerpVectors(arm.knee, arm.hand, 0.9);
      // Long fingers splayed from the hand.
      _d.subVectors(arm.hand, arm.knee).normalize();
      arm.fingers.forEach(([f1, f2], i) => {
        const spread = (i - 1.5) * 0.35;
        _e.copy(_d).addScaledVector(this.right, spread * arm.side).addScaledVector(this.fwd, 0.3).normalize();
        const k1 = _c.copy(arm.hand).addScaledVector(_e, 12);
        placeLimb(f1, arm.hand, k1, 1.2);
        const k2 = _b.copy(k1).addScaledVector(_e, 9).addScaledVector(UPV, -4);
        placeLimb(f2, k1, k2, 0.8);
      });
      this.caps.push({ a: sh, b: arm.knee, r: 4.5 }, { a: arm.knee, b: arm.hand, r: 3.5 });
    }
  }
}

// ---------- THE HIVE MOTHER ----------

const HIVE_LEGS = [28, 62, 105, 145];

class Hive extends Colossus {
  constructor(mgr, o) {
    super(mgr, "hive", o);
    this.bodyH = 48;
    this.stepDist = 26;
    this.swingTime = 1.05;
    this.stepLead = 0.5;
    this.lift = 11;
    this.maxSwing = 4;
    this.footSize = 3;
    this.footShake = 0.35;
    this.turnRate = 0.14;
    this.staggerT = 3.5;
    this.keepAway = o.keepAway ?? 320;
    const M = colossusMaterials();
    const g = this.group;
    const hide = M.hide.hive;
    this.bodyG = new THREE.Group();
    g.add(this.bodyG);
    this.thorax = new THREE.Mesh(lumpyGeometry(this.seed, 18, 13, 22, 0.12, 18), M.body.hive);
    this.bodyG.add(this.thorax);
    this.abdomen = new THREE.Mesh(lumpyGeometry(this.seed + 7, 40, 31, 50, 0.1, 28), M.body.hive);
    this.abdomen.position.set(0, 22, 52);
    this.bodyG.add(this.abdomen);
    // Fangs and a cluster of small red eyes.
    for (const side of [-1, 1]) {
      const f = new THREE.Mesh(spikeGeometry(), M.bone);
      f.position.set(side * 6, -6, -19);
      f.rotation.set(-2.2, 0, side * 0.3);
      f.scale.set(2.2, 14, 2.2);
      this.bodyG.add(f);
    }
    for (let i = 0; i < 8; i++) {
      const e = new THREE.Mesh(colossusGeoBall(), M.glow.eye);
      e.position.set((i % 4 - 1.5) * 3.2, 5 + Math.floor(i / 4) * 2.6, -19.5);
      e.scale.setScalar(1 + (i % 3) * 0.3);
      this.bodyG.add(e);
    }
    HIVE_LEGS.forEach((deg, k) => {
      for (const side of [-1, 1]) {
        const a = (deg * Math.PI) / 180;
        const i = this.legs.length;
        const leg = this.addLeg({ hx: side * Math.sin(a) * 82, hz: Math.cos(a) * 82 - 10, ax: side * Math.sin(a) * 14, az: Math.cos(a) * 16, l1: 64, l2: 80, group: (k + (side > 0 ? 1 : 0)) % 2, i });
        leg.thigh = makeLimb(g, hide, 0.55);
        leg.shin = makeLimb(g, hide, 0.25);
        leg.knob = makeBall(g, hide);
      }
    });
    // Six egg sacs on the abdomen (body frame: +z backward from the thorax).
    const eggAt = [[-22, 22, 30], [22, 22, 30], [-30, 12, 58], [30, 12, 58], [-14, 30, 72], [14, 30, 72]];
    this.eggs = [];
    eggAt.forEach(([x, y, z], i) => {
      const p = makePart(this, "egg", i, 7.5, { glowR: 6, local: new THREE.Vector3(x, y + 22, z), openT: 0 });
      p.mesh = makeBall(g, M.glow.egg);
      this.weak.push(p);
      this.eggs.push(p);
    });
    // The heart under three carapace plates, where the abdomen meets the thorax.
    const heart = makePart(this, "heart", 6, 7.5, { glowR: 5.5 });
    heart.mesh = makeBall(g, M.glow.heart);
    heart.plates = [];
    this.heart = heart;
    this.weak.push(heart);
    for (let i = 0; i < 3; i++) {
      const q = makePart(this, "plate", 10 + i, 9.5, { under: heart, local: new THREE.Vector3((i - 1) * 11, 34, 16 - Math.abs(i - 1) * 3) });
      q.mesh = new THREE.Mesh(plateGeometry(), M.plate);
      g.add(q.mesh);
      heart.plates.push(q);
      this.plates.push(q);
    }
    this.mouth = V();
    this.abdPos = V();
  }

  isHot(p) {
    return p.kind === "egg" && p.openT > 0;
  }

  mult(p) {
    if (p.kind === "egg" && p.openT > 0) return 3;
    return super.mult(p);
  }

  onWeakDestroyed(p) {
    const m = this.mgr;
    if (p.kind === "egg") {
      const left = this.eggs.filter((e) => e.state !== "gone").length;
      if (p.openT > 0) {
        p.openT = 0;
        this.endAttack();
        this.setPhase("stagger");
        this.vulnT = 3;
        m.say("The sac burst as it opened: its brood died inside! The Hive Mother reels.", 4);
      } else m.say(`EGG SAC DESTROYED: ${left} left.`, 2.5);
      m.burst(p.pos, true);
    } else if (p.kind === "heart") this.die();
  }

  think(dt) {
    const m = this.mgr;
    if (!this.standing || this.phase === "stagger") return;
    const a = this.atk;
    if (a.code !== A_NONE) {
      if (a.code === A_OPEN && a.t >= a.dur) {
        // The sacs open: the brood flies out.
        for (const e of this.eggs) {
          if (e.openT <= 0 || e.state === "gone") continue;
          e.openT = 0;
          m.launchSwarm(this, e.pos, this.enraged ? 8 : 6);
        }
        this.endAttack();
      } else if (a.code !== A_OPEN && a.t >= a.dur) this.endAttack();
      return;
    }
    const live = this.eggs.filter((e) => e.state !== "gone");
    const t = m.nearestTarget(this.abdPos, 1100, true) || m.nearestTarget(this.abdPos, 600, false);
    if (t && live.length && (this.cool.launch ?? 3) <= 0 && m.swarmCount() < (this.enraged ? 48 : 36)) {
      this.cool.launch = this.enraged ? 4.5 : 6.5;
      // Enraged, now and then every sac at once.
      const all = this.enraged && Math.random() < 0.35;
      const pick = all ? live : [live[Math.floor(Math.random() * live.length)]];
      for (const e of pick) e.openT = 1.2;
      this.startAttack(A_OPEN, 1.2, pick.length > 1 ? 99 : pick[0].idx, t.pos, t);
      if (all) m.say("Every sac is opening at once!", 3);
      return;
    }
    const s = m.nearestTarget(this.mouth, 520, true);
    if (s && (this.cool.glob ?? 2) <= 0) {
      this.cool.glob = this.enraged ? 3.5 : 5;
      m.spitGlobs(this, this.mouth, s, 2, 160);
    }
  }

  animAttack(dt) {
    const a = this.atk;
    for (const e of this.eggs) if (a.code !== A_OPEN) e.openT = 0;
    if (a.code === A_NONE) return;
    a.t += dt;
    // (A guest: which sacs are opening comes as the side: 99 all, else one.)
    if (a.code === A_OPEN && this.puppet) for (const e of this.eggs) e.openT = e.state !== "gone" && (a.side === 99 || a.side === e.idx) ? Math.max(0.01, a.dur - a.t) : 0;
  }

  pose(dt) {
    const down = this.fall;
    this.tilt.pitch = lerp(this.tilt.pitch, Math.sin(this.s * 0.25) * 0.03, Math.min(1, dt * 2));
    this.tilt.roll = lerp(this.tilt.roll, (this.phase === "stagger" ? Math.sin(this.phaseT * 4) * 0.1 : 0) + down * 0.25, Math.min(1, dt * 2));
    this._frame();
    const T = this.bodyPos.set(this.root.x, lerp(this._feetY() + this.bodyH + Math.sin(this.t * 1.1) * 0.8, this.root.y + 12, down), this.root.z);
    _m.makeBasis(this.right, this.up, _c.copy(this.fwd).negate());
    this.bodyG.position.copy(T);
    this.bodyG.quaternion.setFromRotationMatrix(_m);
    // The abdomen breathes.
    const br = 1 + Math.sin(this.t * 0.8) * 0.025;
    this.abdomen.scale.set(br, br, br);
    this.at(this.abdPos, T, 0, 22, -52);
    this.at(this.mouth, T, 0, -4, 21);
    this.caps.length = 0;
    this.balls.length = 0;
    this.balls.push({ c: T, r: 20 }, { c: this.abdPos, r: 38 });
    this.caps.push({ a: T, b: this.abdPos, r: 30 });
    // Body-frame points: (x right, y up, z backward in the model) to world.
    const local = (out, v) => this.at(out, T, v.x * br, v.y * br, -v.z * br);
    for (const e of this.eggs) {
      local(e.pos, e.local);
      if (e.openT > 0) e.pos.addScaledVector(this.up, 2 * Math.sin(this.t * 30));
    }
    local(this.heart.pos, _a.set(0, 30, 18));
    for (const q of this.plates) local(q.pos, q.local);
    for (const l of this.legs) {
      this.at(l.hip, T, l.ax, 2, l.az);
      _a.set(l.hip.x - T.x, 0, l.hip.z - T.z).normalize();
      const pole = _b.copy(_a).multiplyScalar(0.6).addScaledVector(UPV, down > 0.5 ? -0.2 : 1).normalize();
      solveKnee(l.hip, l.foot, l.l1, l.l2, pole, l.knee);
      placeLimb(l.thigh, l.hip, l.knee, 3.6);
      placeLimb(l.shin, l.knee, l.foot, 2.4);
      l.knob.position.copy(l.knee);
      l.knob.scale.setScalar(4.2);
      this.caps.push({ a: l.hip, b: l.knee, r: 3.8 }, { a: l.knee, b: l.foot, r: 2.8 });
    }
  }
}

function colossusGeoBall() {
  return ballGeometry(1);
}

const KINDS = { strider: Strider, weeper: Weeper, hive: Hive };

// ---------- The manager ----------

export class ColossusManager {
  constructor({ scene, world, camera, effects, audio, ufos, vehicles, player, lasers }) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.effects = effects;
    this.audio = audio;
    this.ufos = ufos;
    this.vehicles = vehicles;
    this.player = player;
    this.lasers = lasers;
    this.list = [];
    this.puppets = false; // (online, a guest: the host's are drawn here)
    this.time = 0;
    this.speedScale = 1;
    this.audioFx = new ColossusAudio(audio);
    // Callbacks (main.js / the director / js/net/colossi.js).
    this.onStat = null; // (name, n) the host's mission stats
    this.onMessage = null; // (text, seconds) everyone's toast
    this.onLocalMessage = null; // (text, seconds) this player's alone
    this.onEvent = null; // (kind, colossus) the director
    this.onGuestHit = null; // (colossus id, part idx, amount, heavy) a guest's hit, to the host
    this.onGuestPop = null; // (slot) a guest's parasite popped on its jet
    this.onSend = null; // (event) a glob or other one-off for the guests
    this.remoteTargets = null; // () => [{ pos, vel, ref, air }] (the host: the guests' aircraft)
    // The swarm (one InstancedMesh) and the acid globs.
    this.swarm = [];
    this.MAX_SWARM = 64;
    this.swarmMesh = new THREE.InstancedMesh(parasiteGeometry(), colossusMaterials().swarm, this.MAX_SWARM);
    this.swarmMesh.count = 0;
    this.swarmMesh.frustumCulled = false;
    this.swarmMesh.name = "colossus-swarm";
    scene.add(this.swarmMesh);
    this.globs = [];
    this.beams = new Map();
    this._noteT = -99;
    this._markEl = null;
    this.markersOn = true;
    this.stats = { swarmKilled: 0 };
    this.stallT = 0;
    // (js/ufos.js: every weapon that hits UFOs asks this too.)
    if (ufos) {
      ufos.extras = ufos.extras || [];
      ufos.extras.push(this);
    }
  }

  // ---------- Spawning ----------

  spawn(kind, o = {}) {
    const C = KINDS[kind];
    if (!C) return null;
    const c = new C(this, o);
    // (The feet start planted round it.)
    c._frame();
    for (const l of c.legs) c.ground(l.foot, l.hx, l.hz);
    c.update(0.001, !this.puppets);
    this.list.push(c);
    // (The jets' aim assist registry, vehicles.aimTargets: its weak points while it lives.)
    const reg = this.vehicles?.aimTargets;
    if (Array.isArray(reg)) {
      c.aimProvider = () => colossusAimEntries(c);
      reg.push(c.aimProvider);
    }
    return c;
  }

  byId(id) {
    return this.list.find((c) => c.id === id) || null;
  }

  remove(c) {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
    c.dispose();
    this.beamOff(c);
    const reg = this.vehicles?.aimTargets;
    const k = Array.isArray(reg) ? reg.indexOf(c.aimProvider) : -1;
    if (k >= 0) reg.splice(k, 1);
    for (const p of this.swarm) if (p.owner === c.id) p.life = Math.min(p.life, 1);
  }

  // A mission over: the living ones go (they sink away into the haze); the dead stay a while.
  dismiss(c) {
    if (!c.alive) return;
    c.setPhase("leave");
    c.endAttack();
  }

  clear() {
    for (const c of [...this.list]) this.remove(c);
    this.swarm.length = 0;
    this.swarmMesh.count = 0;
    for (const g of this.globs) this.scene.remove(g.mesh);
    this.globs.length = 0;
    this.audioFx.setDrone(Infinity);
    this.audioFx.setBeam(false);
  }

  // ---------- The world ----------

  groundAt(x, z) {
    const w = this.world;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    return (w.heightAt ? w.heightAt(ix, iz) : 64) + 1;
  }

  dist(p) {
    return p.distanceTo(this.effects?.listener || this.camera.position);
  }

  shake(k) {
    if (k > 0.01) this.effects?.shake?.add(Math.min(1, k));
  }

  // Dust: a ring of puffs at p (size s, n puffs).
  dust(p, s = 1, n = 10) {
    const fx = this.effects;
    if (!fx?.smoke) return;
    const c0 = this._dustC || (this._dustC = new THREE.Color(0.42, 0.37, 0.31));
    const c1 = this._dustC1 || (this._dustC1 = new THREE.Color(0.6, 0.57, 0.53));
    const q = Math.max(0.35, fxScale(fx));
    n = Math.max(3, Math.round(n * q));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const sp = (4 + Math.random() * 7) * s;
      fx.smoke.spawn({ x: p.x, y: p.y + 0.5, z: p.z, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 2 * s, vz: Math.sin(a) * sp, life: 1.8 + Math.random() * 1.8 * s, size0: 2 * s, size1: (6 + Math.random() * 5) * s, color0: c0, color1: c1, alpha: 0.5, drag: 1.2 });
    }
  }

  // A foot lands: dust, sound, the shake; the host crushes what is under it
  // (trees, a roof: a light dent in the ground); a player under it is hurt.
  footfall(c, p, size, shake) {
    this.footfalls = (this.footfalls || 0) + 1; // (tests)
    c.steps = (c.steps || 0) + 1;
    const d = this.dist(p);
    this.dust(p, size / 3.2, 12);
    this.audioFx.thud(d);
    this.shake(shake * Math.max(0, 1 - d / 380));
    if (!this.puppets) this.crush(p, size);
    this._stomp(p, size * 3.2, c.enraged ? 28 : 20);
  }

  crush(p, r) {
    const w = this.world;
    if (!this.effects?._carve || !w.getChunk?.(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4)) return;
    // A column above the foot (a tree, a house) and a shallow dent.
    try {
      this.effects._carve(_a.set(p.x, p.y + 5, p.z), r + 0.8, { vScale: 0.42, maxRadius: 8 });
    } catch {}
  }

  // A hand slamming the ground (the Watcher's swat into the terrain).
  slam(p, r) {
    this.dust(p, 2, 18);
    const d = this.dist(p);
    this.audioFx.thud(d, true);
    this.shake(0.9 * Math.max(0, 1 - d / 500));
    if (!this.puppets) this.crush(p, r);
    this._stomp(p, r * 3, 26);
  }

  // A fallen colossus hits the ground: the big one.
  collapse(c) {
    const p = _a.set(c.root.x, c.root.y, c.root.z).clone();
    const d = this.dist(p);
    this.dust(p, 5, 36);
    for (let i = 0; i < 6; i++) {
      const q = c.at(_b, p, (Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80);
      q.y = this.groundAt(q.x, q.z);
      this.dust(q, 2.5, 10);
    }
    this.audioFx.thud(d, true);
    this.audioFx.burst(d, true);
    this.shake(1.2 * Math.max(0, 1 - d / 900));
    if (!this.puppets) this.crush(p, 9);
    this._stomp(p, 60, 40);
  }

  // A player (or ground vehicle) on foot near a stomp is hurt (each machine its own).
  _stomp(p, r, dmg) {
    const lt = this.localTarget();
    if (!lt) return;
    const d = Math.hypot(lt.pos.x - p.x, lt.pos.z - p.z);
    if (lt.air || d > r || lt.pos.y - p.y > r * 0.6) return;
    const k = 1 - d / r;
    this.hurtLocal(lt, Math.ceil(dmg * (0.4 + 0.6 * k) * (lt.ref.type ? 2 : 1)), "colossus", _b.set(lt.pos.x - p.x, 6, lt.pos.z - p.z).normalize().multiplyScalar(14 * k));
  }

  burst(p, big = false) {
    const fx = this.effects;
    const d = this.dist(p);
    this.audioFx.burst(d, big);
    if (!fx?.glow) return;
    const c = this._burstC || (this._burstC = new THREE.Color(3, 1.2, 0.4));
    const n = Math.round((big ? 40 : 14) * Math.max(0.4, fxScale(fx)));
    for (let i = 0; i < n; i++) {
      const v = _a.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar((big ? 20 : 9) * (0.5 + Math.random()));
      fx.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, life: 0.6 + Math.random() * 0.8, size0: big ? 3 : 1.5, size1: 0.3, color0: c, alpha: 0.9, drag: 1.5, gravity: 0.4 });
    }
  }

  // Sparks where a shot hit: orange on flesh, blue-white on armour.
  spark(at, kind, k = 1) {
    const fx = this.effects;
    if (!fx?.glow || !at?.isVector3) return;
    const c = kind === "armor" ? this._armC || (this._armC = new THREE.Color(1.6, 2, 2.6)) : this._hitC || (this._hitC = new THREE.Color(3.2, 1.4, 0.4));
    const n = Math.max(2, Math.round(5 * k));
    for (let i = 0; i < n; i++) fx.glow.spawn({ x: at.x, y: at.y, z: at.z, vx: (Math.random() - 0.5) * 14 * k, vy: Math.random() * 8 * k, vz: (Math.random() - 0.5) * 14 * k, life: 0.3, size0: 0.4 * k + 0.3, size1: 0.05, color0: c, alpha: 1, drag: 2, gravity: 0.5 });
  }

  armorNote(c) {
    if (this.time - this._noteT < 6) return;
    this._noteT = this.time;
    this.say(`ARMOR: that does nothing. Hit the glowing weak points; heavy weapons (super missile, mini-nuke) crack its plates.`, 3.5, true);
  }

  say(text, s = 3, local = false) {
    if (local || this.puppets) this.onLocalMessage?.(text, s);
    else this.onMessage?.(text, s);
  }

  // ---------- Targets (who the colossi go for) ----------

  // This machine's own: its aircraft (or vehicle), or the player on foot.
  localTarget() {
    const v = this.vehicles?.active;
    if (v && v.alive !== false) return { ref: v, pos: v.pos, vel: v.vel, air: v.type === "jet" || v.type === "heli" || v.type === "ufo" || v.type === "b2", local: true };
    const p = this.player;
    if (!p || p.dead || p.creative) return null;
    return { ref: p, pos: _lt.set(p.position.x, p.position.y + 0.9, p.position.z), vel: p.velocity, air: false, local: true };
  }

  targetList() {
    const out = [];
    const lt = this.localTarget();
    if (lt) out.push({ ...lt, pos: lt.pos.clone() });
    for (const t of this.remoteTargets?.() || []) out.push(t);
    return out;
  }

  nearestTarget(from, maxD, airOnly = null) {
    let best = null;
    let bd = maxD;
    for (const t of this._targets || this.targetList()) {
      if (airOnly === true && !t.air) continue;
      if (airOnly === false && t.air) continue;
      const d = t.pos.distanceTo(from);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  // Hurts this machine's own player or vehicle (impulse: a shove).
  hurtLocal(t, amount, cause, impulse = null) {
    if (!t?.local) return;
    const r = t.ref;
    if (r === this.player) {
      if (this.player.damage?.(amount, cause, { from: impulse ? r.position.clone().sub(impulse) : undefined }) && impulse) this.player.applyImpulse?.(impulse.clone().multiplyScalar(0.3));
    } else if (r?.damage) {
      r.damage(amount, cause);
      if (impulse && r.vel) r.vel.add(impulse);
    }
  }

  // ---------- Attacks' shared parts ----------

  // Acid globs at target t: n, lobbed with a lead, from p.
  spitGlobs(c, p, t, n, speed) {
    for (let i = 0; i < n; i++) {
      const tof = p.distanceTo(t.pos) / speed;
      const aim = _a.copy(t.pos).addScaledVector(t.vel || _b.set(0, 0, 0), tof * (0.7 + Math.random() * 0.5));
      aim.x += (Math.random() - 0.5) * 30;
      aim.y += (Math.random() - 0.5) * 20 + 5 * tof * tof; // (the drop)
      aim.z += (Math.random() - 0.5) * 30;
      const v = aim.sub(p).normalize().multiplyScalar(speed);
      this.addGlob(p, v, c.id);
      this.onSend?.(["g", r1(p.x), r1(p.y), r1(p.z), r1(v.x), r1(v.y), r1(v.z), c.id]);
    }
    this.audioFx.burst(this.dist(p), false);
  }

  addGlob(p, v, owner) {
    const M = colossusMaterials();
    const mesh = new THREE.Mesh(colossusGeoBall(), M.acid);
    mesh.scale.setScalar(2.2);
    mesh.position.copy(p);
    this.scene.add(mesh);
    this.globs.push({ pos: p.clone(), vel: v.clone(), life: 6, mesh, owner, closest: Infinity });
    if (this.globs.length > 40) {
      const g = this.globs.shift();
      this.scene.remove(g.mesh);
    }
  }

  _updateGlobs(dt) {
    const lt = this.localTarget();
    const fx = this.effects;
    const ac = this._acidC || (this._acidC = new THREE.Color(1.4, 4, 0.3));
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      g.life -= dt;
      g.vel.y -= 10 * dt;
      g.pos.addScaledVector(g.vel, dt);
      g.mesh.position.copy(g.pos);
      if (fx?.glow && Math.random() < 0.7) fx.glow.spawn({ x: g.pos.x, y: g.pos.y, z: g.pos.z, life: 0.35, size0: 1.6, size1: 0.3, color0: ac, alpha: 0.7 });
      let pop = g.life <= 0 || g.pos.y < this.groundAt(g.pos.x, g.pos.z);
      // This machine's own aircraft or player: a direct hit, or flak close by.
      if (lt && !pop) {
        const d = g.pos.distanceTo(lt.pos);
        if (d < (lt.air ? 7 : 3)) {
          this.hurtLocal(lt, lt.air ? 16 : 8, "colossus");
          this.say("Acid hit!", 1.5, true);
          pop = true;
        } else if (lt.air && d > g.closest && g.closest < 16 && !g.flak) {
          g.flak = true;
          this.hurtLocal(lt, 6, "colossus");
          pop = true;
        }
        g.closest = Math.min(g.closest, d);
      }
      if (pop) {
        if (fx?.glow) for (let k = 0; k < 8; k++) fx.glow.spawn({ x: g.pos.x, y: g.pos.y, z: g.pos.z, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16, vz: (Math.random() - 0.5) * 16, life: 0.6, size0: 2.2, size1: 0.4, color0: ac, alpha: 0.8, drag: 2 });
        this.scene.remove(g.mesh);
        this.globs.splice(i, 1);
      }
    }
  }

  // The eye beam from `from` to (through) `aim`: drawn, it scorches where it
  // meets the ground (the host), and it burns this machine's own aircraft.
  beam(c, from, aim, dt) {
    let b = this.beams.get(c);
    const M = colossusMaterials();
    if (!b) {
      b = { core: new THREE.Mesh(limbGeo(), M.beam), halo: new THREE.Mesh(limbGeo(), M.beamHalo), scorch: 0, end: V() };
      b.core.frustumCulled = b.halo.frustumCulled = false;
      this.scene.add(b.core, b.halo);
      this.beams.set(c, b);
    }
    const dir = _a.subVectors(aim, from).normalize();
    // Its length: to the ground (marching in steps), at most 1,200.
    let len = 1200;
    for (let s = 20; s < 1200; s += 12) {
      const x = from.x + dir.x * s;
      const y = from.y + dir.y * s;
      const z = from.z + dir.z * s;
      if (y < this.groundAt(x, z)) {
        len = s;
        break;
      }
    }
    b.end.copy(from).addScaledVector(dir, len);
    const flick = 0.85 + Math.random() * 0.3;
    placeLimb(b.core, from, b.end, 1.3 * flick);
    placeLimb(b.halo, from, b.end, 4.2 * flick);
    b.core.visible = b.halo.visible = true;
    this.audioFx.setBeam(true, this.dist(from));
    // Burns this machine's aircraft (or player) along it.
    const lt = this.localTarget();
    if (lt && segDist(lt.pos, from, b.end) < (lt.air ? 8 : 3)) {
      b.burnT = (b.burnT ?? 0) + dt;
      if (b.burnT > 0.2) {
        this.hurtLocal(lt, Math.ceil((c.enraged ? 60 : 48) * b.burnT), "colossus");
        b.burnT = 0;
        if (this.time - (b.saidT ?? -9) > 3) {
          b.saidT = this.time;
          this.say("THE BEAM IS ON YOU: turn hard!", 1.5, true);
        }
      }
    }
    // Scorches the ground where it ends (the host's edits).
    b.scorch -= dt;
    const fx = this.effects;
    if (fx?.glow && len < 1200) fx.glow.spawn({ x: b.end.x, y: b.end.y + 1, z: b.end.z, vx: (Math.random() - 0.5) * 10, vy: Math.random() * 10, vz: (Math.random() - 0.5) * 10, life: 0.4, size0: 3, size1: 0.5, color0: this._beamC || (this._beamC = new THREE.Color(5, 0.8, 0.3)), alpha: 0.9 });
    if (b.scorch <= 0 && len < 1200) {
      b.scorch = 0.3;
      if (!this.puppets) this.crush(b.end, 1.8);
    }
  }

  beamOff(c) {
    const b = this.beams.get(c);
    if (!b) return;
    this.scene.remove(b.core, b.halo);
    this.beams.delete(c);
    if (!this.beams.size) this.audioFx.setBeam(false);
  }

  // The screech: a shake, and this machine's aircraft within `r` stall a moment.
  roar(c, from, r) {
    const d = this.dist(from);
    this.audioFx.screech(d, c.kind === "weeper" ? 1 : 0.7);
    this.shake(0.7 * Math.max(0, 1 - d / 700));
    const lt = this.localTarget();
    if (lt && lt.air && lt.pos.distanceTo(from) < r && lt.ref.type === "jet") {
      this.stallT = 2.6;
      this.stallJet = lt.ref;
      this.say("THE SCREECH! Your engines stalled: they'll catch again in a moment.", 2.5, true);
    }
  }

  // ---------- The swarm ----------

  swarmCount() {
    return this.swarm.length;
  }

  launchSwarm(c, at, n) {
    for (let i = 0; i < n && this.swarm.length < this.MAX_SWARM; i++) {
      const v = _a.set(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(60);
      this.swarm.push({ pos: at.clone(), vel: v.clone(), life: 24, owner: c.id, slot: this._slot(), target: null, decoy: null, phase: Math.random() * 6, hp: 1, popped: false });
    }
    this.burst(at, false);
  }

  _slot() {
    const used = new Set(this.swarm.map((p) => p.slot));
    for (let i = 0; i < this.MAX_SWARM * 2; i++) if (!used.has(i)) return i;
    return 0;
  }

  _updateSwarm(dt) {
    const host = !this.puppets;
    const decoys = this.lasers?.decoys || [];
    const lt = this.localTarget();
    let near = 0;
    let nearD = Infinity;
    for (let i = this.swarm.length - 1; i >= 0; i--) {
      const p = this.swarm[i];
      p.phase += dt * 30;
      if (!host) {
        // A guest: eased toward the host's positions.
        if (p.netPos) p.pos.lerp(p.netPos, 1 - Math.exp(-dt * 8));
        if (lt && lt.air && !p.popped && p.pos.distanceTo(lt.pos) < 7) {
          p.popped = true;
          this.hurtLocal(lt, 7, "colossus");
          this._popFx(p.pos);
          this.onGuestPop?.(p.slot);
        }
        continue;
      }
      p.life -= dt;
      const speed = 152 * (this.byId(p.owner)?.enraged ? 1.12 : 1);
      // Flares lure them (most of them, each decides once per flare).
      if (!p.decoy || p.decoy.life <= 0) {
        p.decoy = null;
        for (const d of decoys) {
          if (d.life <= 0 || d.pos.distanceTo(p.pos) > 240) continue;
          d._lure ??= Math.random();
          if ((d._lure * 7.13 + p.slot * 0.618) % 1 < 0.75) {
            p.decoy = d;
            break;
          }
        }
      }
      let tp = null;
      let tv = null;
      if (p.decoy) tp = p.decoy.pos;
      else {
        if (!p.target || (p.retarget = (p.retarget ?? 0) - dt) <= 0) {
          p.retarget = 1;
          p.target = this.nearestTarget(p.pos, 1500, true) || this.nearestTarget(p.pos, 300, false);
        }
        if (p.target) {
          tp = p.target.pos;
          tv = p.target.vel;
        }
      }
      if (tp) {
        const dist = p.pos.distanceTo(tp);
        const aim = _a.copy(tp);
        if (tv) aim.addScaledVector(tv, Math.min(1.2, dist / speed) * 0.6);
        const want = aim.sub(p.pos).normalize();
        const cur = _b.copy(p.vel).normalize();
        cur.lerp(want, Math.min(1, dt * 2.1)).normalize();
        const sp = Math.min(speed, p.vel.length() + 120 * dt);
        p.vel.copy(cur).multiplyScalar(sp);
        // On a flare: it pops on it.
        if (p.decoy && dist < 6) {
          this._popFx(p.pos);
          this.swarm.splice(i, 1);
          continue;
        }
        // On this machine's own aircraft (the host's): it bursts against it.
        if (p.target?.local && dist < 7 && !p.decoy) {
          this.hurtLocal(p.target, 7, "colossus");
          this._popFx(p.pos);
          this.swarm.splice(i, 1);
          continue;
        }
      } else p.vel.y -= 9 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const gy = this.groundAt(p.pos.x, p.pos.z);
      if (p.pos.y < gy + 2) {
        p.pos.y = gy + 2;
        p.vel.y = Math.abs(p.vel.y) * 0.5;
      }
      if (p.life <= 0) {
        this._popFx(p.pos);
        this.swarm.splice(i, 1);
      }
    }
    if (lt) for (const p of this.swarm) {
      const d = p.pos.distanceTo(lt.pos);
      if (d < 60) near++;
      nearD = Math.min(nearD, d);
    }
    this._chitT = (this._chitT ?? 0) - dt;
    if (near && this._chitT <= 0) {
      this._chitT = 0.25;
      this.audioFx.chitter(near, nearD);
    }
  }

  _popFx(p) {
    const fx = this.effects;
    if (!fx?.glow) return;
    const c = this._popC || (this._popC = new THREE.Color(3.5, 0.9, 0.5));
    for (let k = 0; k < 6; k++) fx.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12, vz: (Math.random() - 0.5) * 12, life: 0.4, size0: 1.2, size1: 0.2, color0: c, alpha: 0.9, drag: 2 });
  }

  // A parasite shot down (the host; mine: a player's kill).
  killParasite(p, mine = true) {
    const i = this.swarm.indexOf(p);
    if (i < 0) return false;
    this.swarm.splice(i, 1);
    this._popFx(p.pos);
    if (mine) {
      this.stats.swarmKilled++;
      this.onStat?.("parasitesDown", 1);
    }
    return true;
  }

  _drawSwarm() {
    const mesh = this.swarmMesh;
    let n = 0;
    for (const p of this.swarm) {
      if (n >= this.MAX_SWARM || p.popped) continue;
      _a.copy(p.vel);
      if (_a.lengthSq() < 1e-4) _a.set(0, 0, -1);
      _a.normalize();
      _m.lookAt(_b.set(0, 0, 0), _a, UPV);
      _q.setFromRotationMatrix(_m);
      const flap = 0.55 + 0.45 * Math.abs(Math.sin(p.phase));
      _c.set(1.7 * flap + 0.2, 1.7, 1.7);
      _m.compose(p.pos, _q, _c);
      mesh.setMatrixAt(n++, _m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- The weapons' side (js/ufos.js extras) ----------

  // The nearest part along a ray: { ufo: part, distance } (js/ufos.js raycast).
  raycast(origin, dir, maxDist, filter = null) {
    let best = null;
    let bd = maxDist;
    for (const c of this.list) {
      if (!c.alive || c.sink > 20) continue;
      // Broad phase: the bounding sphere.
      _c.set(c.root.x, c.root.y + c.spec.center - c.sink, c.root.z);
      if (raySphere(origin, dir, _c, c.spec.bound, bd) < 0) continue;
      for (const p of c.weak) {
        if (p.state === "gone" || (filter && !filter(p))) continue;
        const t = raySphere(origin, dir, p.pos, p.radius, bd);
        if (t >= 0) {
          bd = t;
          best = p;
        }
      }
      for (const q of c.plates) {
        if (q.state === "gone" || (filter && !filter(q))) continue;
        const t = raySphere(origin, dir, q.pos, q.radius, bd);
        if (t >= 0) {
          bd = t;
          best = q;
        }
      }
      if (filter && !filter(c.hide)) continue;
      for (const s of c.balls) {
        const t = raySphere(origin, dir, s.c, s.r, bd);
        if (t >= 0) {
          bd = t;
          best = c.hide;
        }
      }
      for (const k of c.caps) {
        const t = rayCapsule(origin, dir, k.a, k.b, k.r, bd);
        if (t >= 0) {
          bd = t;
          best = c.hide;
        }
      }
    }
    for (const p of this.swarm) {
      if (p.popped) continue;
      const t = raySphere(origin, dir, p.pos, 2.6, bd);
      if (t >= 0) {
        bd = t;
        best = this._parasitePart(p);
      }
    }
    if (best && best.kind === "hide") best.pos.copy(origin).addScaledVector(dir, bd);
    return best ? { ufo: best, distance: bd } : null;
  }

  // A parasite as a part (one reused object a parasite; its hit kills it).
  _parasitePart(p) {
    if (!p.part) {
      p.part = { kind: "parasite", radius: 2.6, hitHalfHeight: 2.6, pos: p.pos, vel: p.vel, state: "alive", falling: false, hostile: true, size: "small", extDamage: (amount, byPlayer) => this._hitParasite(p, byPlayer) };
    }
    return p.part;
  }

  _hitParasite(p, byPlayer) {
    if (!byPlayer) return false;
    if (this.puppets) {
      if (p.popped) return false;
      p.popped = true;
      this._popFx(p.pos);
      this.onGuestHit?.(-1, -100 - p.slot, 1, false);
      return true;
    }
    return this.killParasite(p, true);
  }

  sphereHit(pos, r) {
    for (const c of this.list) {
      if (!c.alive) continue;
      for (const p of c.weak) if (p.state !== "gone" && p.pos.distanceTo(pos) < p.radius + r) return p;
      for (const q of c.plates) if (q.state !== "gone" && q.pos.distanceTo(pos) < q.radius + r) return q;
      for (const s of c.balls) if (s.c.distanceTo(pos) < s.r + r) return c.hide;
      for (const k of c.caps) if (segDist(pos, k.a, k.b) < k.r + r) return c.hide;
    }
    for (const p of this.swarm) if (!p.popped && p.pos.distanceTo(pos) < 2.6 + r) return this._parasitePart(p);
    return null;
  }

  // A blast (js/ufos.js explosion): the weak points and plates near it; a
  // heavy one cracks plates; the parasites near it die. One blast takes at
  // most its budget off a colossus's core (a mini-nuke never kills one).
  explosion(center, radius, byPlayer = true) {
    if (!byPlayer) return;
    const heavy = radius >= HEAVY_BLAST;
    for (const c of this.list) {
      if (!c.alive) continue;
      _c.set(c.root.x, c.root.y + c.spec.center, c.root.z);
      if (_c.distanceTo(center) > c.spec.bound + radius * 2) continue;
      if (this.puppets) {
        // A guest: the blast's numbers go to the host, which applies them.
        this.onGuestHit?.(c.id, -2, radius, heavy, [r1(center.x), r1(center.y), r1(center.z)]);
        continue;
      }
      this.blastOn(c, center, radius, heavy);
    }
    const reach = radius * 1.8 + 3;
    for (const p of [...this.swarm]) if (p.pos.distanceTo(center) < reach) {
      if (this.puppets) this._hitParasite(p, true);
      else this.killParasite(p, true);
    }
  }

  blastOn(c, center, radius, heavy) {
    c.blastBudget = c.maxHp * Math.min(0.3, (heavy ? 0.04 : 0.01) + radius * 0.0017);
    this._inBlast = true;
    try {
      const reach = radius * 1.6 + 4;
      for (const q of c.plates) {
        if (q.state === "gone") continue;
        const d = Math.max(0, q.pos.distanceTo(center) - q.radius);
        // (A nuke's blast cracks every plate it reaches; a super missile's
        // cracks the one it hits, its blast only chips the others.)
        if (radius >= 30 && d < radius * 1.2 + 4) c.crack(q);
        else if (d < reach) {
          q.hp -= 10 * radius * (1 - d / reach);
          if (q.hp <= 0) c.crack(q);
        }
      }
      for (const p of c.weak) {
        if (p.state === "gone") continue;
        const d = Math.max(0, p.pos.distanceTo(center) - p.radius);
        if (d >= reach) continue;
        const f = 1 - d / reach;
        const dmg = (heavy ? 22 : 14) * radius * f;
        if (c.armored(p)) c._damageWeak(p, dmg * ARMOR_SMALL);
        else c._damageWeak(p, dmg * c.mult(p));
      }
      // The hide: a heavy blast hurts the core a little.
      if (heavy) {
        _c.set(c.root.x, c.root.y + c.spec.center, c.root.z);
        const d = Math.max(0, _c.distanceTo(center) - c.spec.bound * 0.6);
        if (d < radius * 2) c.damageCore(c.maxHp * 0.04 * (1 - d / (radius * 2)), true);
      }
    } finally {
      this._inBlast = false;
    }
  }

  // Every hit on a part comes here (only the players' weapons count).
  _hit(c, p, amount, byPlayer, from) {
    if (!byPlayer || !c.alive || amount <= 0) return false;
    const heavy = amount >= HEAVY_HIT;
    if (this.puppets) {
      // A guest: the host decides; the sparks here at once.
      this.spark(from, c.armored(p) || p.kind === "plate" || (p.kind === "hide" && !heavy) ? "armor" : "hit", 1);
      this.onGuestHit?.(c.id, p.idx, amount, heavy);
      return true;
    }
    return c.hit(p, amount, heavy, from);
  }

  // A guest's hit, on the host (from js/net/colossi.js).
  applyGuestHit(id, idx, amount, heavy, at) {
    if (this.puppets) return;
    if (idx <= -100) {
      const p = this.swarm.find((x) => x.slot === -100 - idx);
      if (p) this.killParasite(p, true);
      return;
    }
    const c = this.byId(id);
    if (!c || !c.alive || !Number.isFinite(amount) || amount <= 0) return;
    amount = Math.min(amount, 2000);
    if (idx === -2) {
      if (Array.isArray(at) && at.length === 3 && at.every(Number.isFinite)) this.blastOn(c, _d.set(at[0], at[1], at[2]), Math.min(amount, 120), !!heavy);
      return;
    }
    const p = idx === -1 ? c.hide : [...c.weak, ...c.plates].find((x) => x.idx === idx);
    if (p) c.hit(p, amount, !!heavy, p.pos);
  }

  popGuest(slot) {
    const p = this.swarm.find((x) => x.slot === slot);
    if (p) {
      const i = this.swarm.indexOf(p);
      this.swarm.splice(i, 1);
    }
  }

  // ---------- The jets' lock-on (see colossusAimTargets) ----------

  aimTargets() {
    const out = [];
    for (const c of this.list) {
      if (!c.alive) continue;
      for (const p of c.weak) if (p.state !== "gone" && !c.armored(p)) out.push(p);
      for (const q of c.plates) if (q.state !== "gone") out.push(q);
    }
    return out;
  }

  // ---------- Events for the director (host) ----------

  onPart(c, p, what) {
    this.burst(p.pos, what === "destroy" && (p.kind === "sac" || p.kind === "heart"));
    if (what === "destroy" && p.kind === "eye") this.onStat?.("watcherEyes", 1);
    if (what === "destroy") this.onStat?.("weakPointsDown", 1);
    this.onEvent?.(what, c, p);
  }

  onEnrage(c) {
    this.audioFx.screech(this.dist(c.bodyPos), 0.6);
  }

  onDown(c) {
    c.downed = true;
    this.say(`${c.spec.name} IS DOWN!`, 5);
    this.onStat?.(`${c.kind}Down`, 1);
    this.onStat?.("colossiDown", 1);
    this.onEvent?.("down", c);
    this.burst(c.bodyPos, true);
  }

  onAttack(c, code) {
    this.onEvent?.("attack", c, code);
  }

  // ---------- Every frame ----------

  update(dt) {
    if (!this.list.length && !this.swarm.length && !this.globs.length) {
      if (this._hadAny) {
        this._hadAny = false;
        this.audioFx.setDrone(Infinity);
        this.audioFx.setBeam(false);
        this._markers(null);
      }
      return;
    }
    this._hadAny = true;
    this.time += dt;
    const host = !this.puppets;
    this._targets = this.targetList();
    let nearest = Infinity;
    let rage = false;
    const cam = this.camera.position;
    for (const c of [...this.list]) {
      c.update(dt, host);
      if (c.atk.code !== A_BEAM) this.beamOff(c);
      const d = Math.hypot(c.root.x - cam.x, c.root.z - cam.z);
      if (c.alive) {
        if (d < nearest) nearest = d;
        rage ||= c.enraged;
      }
      setLod(c.group, d > 650 ? 1 : 0);
      if (host && c.phase === "dead" && c.phaseT > 45) this.remove(c);
      else if (host && c.phase === "leave" && c.sink > 260) this.remove(c);
    }
    this._targets = null;
    this._haze(cam);
    this._updateGlobs(dt);
    this._updateSwarm(dt);
    this._drawSwarm();
    this._updateStall(dt);
    // Bumping into one: an aircraft flown into a leg or the body is hurt and thrown off.
    this._bump(dt);
    this.audioFx.setDrone(nearest < 2500 ? nearest : Infinity, rage);
    this._markers(this.camera);
  }

  _updateStall(dt) {
    if (this.stallT <= 0) return;
    this.stallT -= dt;
    const j = this.stallJet;
    if (!j || j !== this.vehicles?.active) {
      this.stallT = 0;
      return;
    }
    j.throttle = 0;
    j.afterburner = false;
    j.abLatch = false;
    if (this.stallT <= 0) this.say("Engines relit.", 1.5, true);
  }

  _bump(dt) {
    this._bumpT = (this._bumpT ?? 0) - dt;
    const lt = this.localTarget();
    if (!lt || !lt.air || this._bumpT > 0) return;
    const r = lt.ref.hitRadius ?? 4;
    for (const c of this.list) {
      if (c.sink > 20) continue;
      let hit = null;
      for (const s of c.balls) if (s.c.distanceTo(lt.pos) < s.r + r) hit = s.c;
      for (const k of c.caps) if (!hit && segDist(lt.pos, k.a, k.b) < k.r + r) hit = _e.copy(k.a).add(k.b).multiplyScalar(0.5);
      if (hit) {
        this._bumpT = 1.2;
        this.hurtLocal(lt, 45, "colossus", _a.subVectors(lt.pos, hit).setY(0).normalize().multiplyScalar(45));
        this.say("You clipped the colossus!", 2, true);
        this.shake(0.8);
        return;
      }
    }
  }

  // Far off the hides fade toward the horizon's colour (a silhouette in the haze).
  _haze(cam) {
    const M = colossusMaterials();
    const fog = this.scene.fog;
    if (!fog) return;
    for (const kind of ["strider", "weeper", "hive"]) {
      let d = Infinity;
      for (const c of this.list) if (c.kind === kind) d = Math.min(d, c.bodyPos.distanceTo(cam));
      if (!Number.isFinite(d)) continue;
      const k = clamp((d - 220) / 1600, 0, 0.62);
      for (const mat of [M.hide[kind], M.body[kind]]) mat.color.copy(HIDE_COLORS[kind]).lerp(fog.color, k);
    }
  }

  // ---------- The HUD's weak-point markers ----------

  _markers(camera) {
    if (typeof document === "undefined") return;
    let el = this._markEl;
    if (!camera || !this.markersOn) {
      if (el) el.style.display = "none";
      return;
    }
    if (!el) {
      el = this._markEl = document.createElement("div");
      el.id = "colossus-marks";
      el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9;overflow:hidden";
      const st = document.createElement("style");
      st.textContent = `body.hud-off #colossus-marks{display:none!important}
      #colossus-marks .cm{position:absolute;transform:translate(-50%,-50%);font:700 10px ui-monospace,Consolas,monospace;letter-spacing:1px;color:#ffb06a;text-shadow:0 1px 3px #000;text-align:center;white-space:nowrap}
      #colossus-marks .cm i{display:block;margin:0 auto 2px;width:12px;height:12px;border:2px solid currentColor;transform:rotate(45deg);box-shadow:0 0 6px currentColor}
      #colossus-marks .cm b{display:block;margin:2px auto 0;height:3px;width:28px;background:rgba(0,0,0,.6)}
      #colossus-marks .cm b s{display:block;height:100%;background:currentColor}
      #colossus-marks .cm.armor{color:#a9c4d8}#colossus-marks .cm.hot{color:#fff36a;animation:cmh .25s infinite alternate}
      @keyframes cmh{to{transform:translate(-50%,-50%) scale(1.25)}}`;
      document.head.appendChild(st);
      document.body.appendChild(el);
      this._marks = [];
    }
    el.style.display = "";
    const W = window.innerWidth;
    const H = window.innerHeight;
    const list = [];
    for (const c of this.list) {
      if (!c.alive || c.sink > 10) continue;
      const dc = c.bodyPos.distanceTo(camera.position);
      if (dc > 2200) continue;
      for (const p of c.weak) {
        if (p.state === "gone") continue;
        const arm = c.armored(p);
        const np = arm ? p.plates.filter((q) => q.state !== "gone").length : 0;
        list.push({ p, key: `${c.id}:${p.kind}:${arm ? 1 : 0}`, cls: arm ? "armor" : c.isHot(p) ? "hot" : "", label: arm ? `${WEAK[p.kind].label}: ARMOR ${np} (HEAVY)` : c.isHot(p) ? `${WEAK[p.kind].label} x3!` : WEAK[p.kind].label, f: p.hp / p.maxHp, d: dc });
      }
    }
    // (On screen: weak points of a kind close together are one marker, "EYE x7".)
    const shown = [];
    for (const e of list) {
      _a.copy(e.p.pos).project(camera);
      if (_a.z > 1 || _a.z < -1 || Math.abs(_a.x) > 1.05 || Math.abs(_a.y) > 1.05) continue;
      const x = ((_a.x + 1) / 2) * W;
      const y = ((1 - _a.y) / 2) * H;
      const near = shown.find((o) => o.key === e.key && Math.hypot(o.x - x, o.y - y) < 26);
      if (near) {
        near.n++;
        near.f = Math.min(near.f, e.f);
        continue;
      }
      shown.push({ ...e, x, y, n: 1 });
    }
    const marks = this._marks;
    let n = 0;
    for (const e of shown) {
      if (n >= 24) break;
      let m = marks[n];
      if (!m) {
        m = marks[n] = document.createElement("div");
        m.innerHTML = "<i></i><span></span><b><s></s></b>";
        el.appendChild(m);
      }
      m.style.display = "";
      const cls = `cm ${e.cls}`;
      if (m.className !== cls) m.className = cls;
      m.style.left = `${e.x}px`;
      m.style.top = `${e.y}px`;
      const sp = m.children[1];
      const txt = e.d < 900 ? `${e.label}${e.n > 1 ? ` x${e.n}` : ""}` : "";
      if (sp.textContent !== txt) sp.textContent = txt;
      m.children[2].firstChild.style.width = `${Math.round(clamp(e.f, 0, 1) * 100)}%`;
      n++;
    }
    for (let i = n; i < marks.length; i++) marks[i].style.display = "none";
  }

  // ---------- Online (js/net/colossi.js) ----------

  // The host's state for the guests, compactly.
  netState() {
    const out = [];
    for (const c of this.list) {
      const a = c.atk;
      out.push([c.id, c.kind, c.seed, r1(c.root.x), r1(c.root.z), Math.round(c.yaw * 1000) / 1000, Math.round(c.s), PHASES.indexOf(c.phase), Math.round(c.phaseT * 10) / 10, Math.round((c.hp / c.maxHp) * 1000), c.enraged ? 1 : 0, [...c.weak, ...c.plates].map((p) => (p.state === "gone" ? -1 : Math.round((p.hp / p.maxHp) * 100))), a.code, Math.round(a.t * 10) / 10, a.side, r1(a.aim.x), r1(a.aim.y), r1(a.aim.z), a.n, Math.round(c.vulnT * 10) / 10, Math.round(c.sink), c.maxHp]);
    }
    const sw = this.swarm.slice(0, this.MAX_SWARM).map((p) => [p.slot, r1(p.pos.x), r1(p.pos.y), r1(p.pos.z)]);
    return { l: out, w: sw };
  }

  // A guest mirrors it.
  applyNet(s) {
    if (!s || !Array.isArray(s.l)) return;
    const seen = new Set();
    for (const e of s.l) {
      if (!Array.isArray(e) || e.length < 21 || !KINDS[e[1]]) continue;
      const [id, kind, seed, x, z, yaw, walked, ph, phT, hp, rage, parts, code, at, side, ax, ay, az, n, vulnT, sink, maxHp] = e;
      if (![x, z, yaw].every(Number.isFinite)) continue;
      seen.add(id);
      let c = this.byId(id);
      if (!c) c = this.spawn(kind, { id, seed, x, z, yaw });
      c.puppet = true;
      c.net = { x, z, yaw };
      c.s = Number(walked) || c.s;
      const phase = PHASES[ph] || "walk";
      if (c.phase !== phase) c.setPhase(phase);
      c.phaseT = Number(phT) || c.phaseT;
      if (Number.isFinite(maxHp) && maxHp > 0) c.maxHp = maxHp;
      c.hp = (clamp(Number(hp) || 0, 0, 1000) / 1000) * c.maxHp;
      c.enraged = !!rage;
      c.vulnT = Number(vulnT) || 0;
      c.sink = Number(sink) || 0;
      const all = [...c.weak, ...c.plates];
      if (Array.isArray(parts)) all.forEach((p, i) => {
        const v = parts[i];
        if (!Number.isFinite(v)) return;
        const gone = v < 0;
        if (gone && p.state !== "gone") {
          p.state = "gone";
          this.burst(p.pos, false);
          if (p.leg) p.leg.dead = true;
          if (p.arm) p.arm.dead = true;
        } else if (!gone && p.state === "gone") {
          p.state = "alive";
          if (p.leg) p.leg.dead = false;
        }
        if (!gone) {
          const hpNew = (v / 100) * p.maxHp;
          if (hpNew < p.hp - 1) p.flash = 0.2;
          p.hp = hpNew;
        }
      });
      const a = c.atk;
      if (a.n !== n || a.code !== code) {
        a.code = code | 0;
        a.n = n;
        a.t = Number(at) || 0;
        a.hit = false;
        a.started = false;
        a.side = side | 0;
        a.dur = { [A_SWAT]: 1.9, [A_CHARGE]: 2.6, [A_BEAM]: 2.8, [A_ROAR]: 2.4, [A_LASH]: 1.35, [A_OPEN]: 1.2 }[a.code] || 0;
      }
      if ([ax, ay, az].every(Number.isFinite)) {
        if (a.code === A_BEAM) a.aim.lerp(_a.set(ax, ay, az), 0.5);
        else a.aim.set(ax, ay, az);
      }
    }
    for (const c of [...this.list]) if (!seen.has(c.id)) this.remove(c);
    // The swarm.
    if (Array.isArray(s.w)) {
      const keep = new Map(this.swarm.map((p) => [p.slot, p]));
      const next = [];
      for (const e of s.w) {
        if (!Array.isArray(e) || e.length < 4 || !e.slice(1).every(Number.isFinite)) continue;
        let p = keep.get(e[0]);
        if (!p) p = { slot: e[0], pos: new THREE.Vector3(e[1], e[2], e[3]), vel: V(), netPos: V(), phase: Math.random() * 6, popped: false };
        else if (p.popped) {
          next.push(p);
          continue;
        }
        p.vel.set(e[1] - p.pos.x, e[2] - p.pos.y, e[3] - p.pos.z).multiplyScalar(6);
        (p.netPos ||= V()).set(e[1], e[2], e[3]);
        next.push(p);
      }
      // (Popped here: gone once the host drops it.)
      this.swarm = next.filter((p) => !p.popped || s.w.some((e) => e[0] === p.slot));
    }
  }

  // A one-off from the host (a glob).
  applyEvent(e) {
    if (!Array.isArray(e)) return;
    if (e[0] === "g" && e.slice(1, 7).every(Number.isFinite)) this.addGlob(_a.set(e[1], e[2], e[3]), _b.set(e[4], e[5], e[6]), e[7]);
  }

  // The status for the director's boss bar: the colossus nearest the players.
  focus(from) {
    let best = null;
    let bd = Infinity;
    for (const c of this.list) {
      if (!c.alive) continue;
      const d = c.root.distanceTo(from);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }
}

const _lt = new THREE.Vector3();
const r1 = (v) => Math.round(v * 10) / 10;
function fxScale(fx) {
  return fx?.quality?.scale ?? 1;
}
let _limbGeo = null;
function limbGeo() {
  if (!_limbGeo) {
    _limbGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    _limbGeo.translate(0, 0.5, 0);
  }
  return _limbGeo;
}

// (Round 21) The adapter for the jets' lock-on (and, later, a shared aim
// registry): every weak point and armour plate a missile may lock onto, as
// the jets' lockables ({ kind: "ufo", ref: part, weight, attacking }). The
// parts look like UFOs to the lock (pos, vel, radius, state, boss, bossName),
// and a hit goes through js/ufos.js damage() to the part's extDamage.
export function colossusAimTargets(mgr) {
  if (!mgr) return [];
  return mgr.aimTargets().map((p) => ({ kind: "ufo", ref: p, weight: p.kind === "plate" ? 1.1 : 1.3, attacking: true }));
}

// (Round 21) The same for the jets' aim assist registry (vehicles.aimTargets:
// { pos, vel, radius, ref, name }): colossus c's open weak points and plates.
export function colossusAimEntries(c) {
  if (!c.alive || c.sink > 10) return [];
  const out = [];
  for (const p of c.weak) if (p.state !== "gone" && !c.armored(p)) out.push({ pos: p.pos, vel: p.vel, radius: p.radius, ref: p, name: p.bossName });
  for (const q of c.plates) if (q.state !== "gone") out.push({ pos: q.pos, vel: q.vel, radius: q.radius, ref: q, name: q.bossName });
  return out;
}

export const COLOSSUS_ATTACKS = { A_NONE, A_SWAT, A_CHARGE, A_BEAM, A_ROAR, A_LASH, A_OPEN };
