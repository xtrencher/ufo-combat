// (Round 13) The pilot's radio voice: short callouts, the way a fighter
// pilot calls them, when you shoot down an aircraft ("Splash one!"), a UFO
// ("UFO destroyed!"), a Ball UFO ("Ball UFO down!"), a boss ("Target
// destroyed!"), a tank ("Tank destroyed!"), an AA vehicle; "Fox two!" when a guided missile
// leaves the rail, "Missile, missile!" when one comes for you.
//
// The words come from the browser's own speech (the Web Speech API): an
// English voice, a man's when there is one, a little low and clipped, with
// a radio click and a burst of squelch before and after each line and a
// faint static bed while it is on the air (audio.js, the "voice" volume).
// One line at a time: the rest wait their turn (a warning first), the same
// line isn't repeated within its cooldown, and stale ones are dropped.
// Without speech (an old browser, a test page), just the radio clicks.
//
//   voice.say(key)          one of LINES below (other parts call this too)
//   voice.kill(kind, ref)   a kill: "jet", "ufo" (ref: the UFO), "boss", "tank", "aa", "launcher"
//   voice.attach({ audio, stats, ufos, listener })
//     audio: its master and voice volumes, the radio sounds; stats: the
//     kills of this player (stats.add of "ufosDown", "enemyJetsDown", ...,
//     which every kill of ours goes through, online on a guest too); ufos:
//     to tell a Ball UFO or a boss from the one that just fell.
//   voice.enabled           the "Voice callouts" setting
export const LINES = {
  splash1: ["Splash one!", "Splash one. Bandit down!"],
  splash2: ["Splash two!"],
  splash3: ["Splash three!"],
  ufo: ["UFO destroyed!", "Object taken down!", "Bogey down!", "UFO down. Good kill!"],
  ball: ["Ball UFO down!", "Ball UFO destroyed!"],
  mothership: ["Mothership destroyed!", "Mothership is going down!"],
  boss: ["Target destroyed!", "Primary target destroyed. Good kill!"],
  tank: ["Tank destroyed!", "Armor down. Good hit!"],
  aa: ["AA vehicle destroyed!", "Triple-A down!"],
  launcher: ["Launcher destroyed!", "Missile launcher down!"],
  fox2: ["Fox two!"],
  salvo: ["Fox two, salvo!"],
  missile: ["Missile, missile!", "Missile inbound!"],
  defeated: ["Missile defeated!"],
  goodkill: ["Good kill!"],
};
// Seconds before the same line can come again.
const COOLDOWN = { missile: 6, fox2: 1.5, salvo: 2.5, defeated: 4, goodkill: 3, boss: 12, mothership: 5 };
// Waiting lines: a warning goes to the front; anything older than this is stale.
const URGENT = new Set(["missile", "defeated"]);
const STALE = 4.5;
const MAX_QUEUE = 3;
// The stats that are this player's kills, and what each is called out as.
const KILL_STATS = { ufosDown: "ufo", enemyJetsDown: "jet", bossesDown: "boss", tanksDown: "tank", aaDown: "aa", launchersDown: "launcher", telsDown: "launcher" };
const RANK = { ufo: 1, ball: 2, mothership: 3, boss: 4, tank: 1, aa: 1, launcher: 1 };

function now() {
  return typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000;
}

export class PilotVoice {
  constructor() {
    this.enabled = true;
    this.audio = null;
    this.ufos = null;
    this.listener = null;
    this.queue = []; // { key, text, t }
    this.busy = false;
    this.last = {}; // key -> time last said
    this.said = []; // (the tests: the lines that went on the air)
    this._voice = undefined;
    this._pending = null; // kills of this moment, called out together
    this._timer = null;
  }

  attach({ audio = null, stats = null, ufos = null, listener = null } = {}) {
    if (audio) this.audio = audio;
    if (ufos) this.ufos = ufos;
    if (listener) this.listener = listener;
    if (stats && !stats._voiceHooked) {
      stats._voiceHooked = true;
      const add = stats.add.bind(stats);
      stats.add = (key, n = 1) => {
        add(key, n);
        const kind = KILL_STATS[key];
        if (!kind) return;
        if (kind !== "ufo") return this.kill(kind);
        // (A UFO counts when it hits the ground: called out already when it
        // was shot down, if that was here.)
        const u = this._fallenUfo();
        if (u?._voiced) return;
        if (u) u._voiced = true;
        this.kill("ufo", u);
      };
    }
    // The moment a UFO is shot down by this player (the host's or a single
    // player's own: a UFO a guest sees is the host's), not seconds later
    // when it hits the ground.
    if (ufos && typeof ufos._shotDown === "function" && !ufos._voiceHooked) {
      ufos._voiceHooked = true;
      const down = ufos._shotDown.bind(ufos);
      ufos._shotDown = (u) => {
        down(u);
        if (!u.net && u.byPlayer && (u.lastHitPid ?? 1) === 1 && !u._voiced) {
          u._voiced = true;
          this.kill("ufo", u);
        }
      };
    }
    const synth = this._synth();
    if (synth && synth.addEventListener && !this._listening) {
      this._listening = true;
      synth.addEventListener("voiceschanged", () => (this._voice = undefined));
      // (The browser's own queue outlives the page: nothing said into the next one.)
      window.addEventListener?.("pagehide", () => this.clear());
    }
    return this;
  }

  // The UFO that has just come down (still falling), nearest to us.
  _fallenUfo() {
    const list = this.ufos?.ufos;
    if (!list) return null;
    let best = null;
    let bd = Infinity;
    const L = this.listener;
    for (const u of list) {
      if (!u.falling) continue;
      const d = L && u.pos ? u.pos.distanceTo(L) : 0;
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  // A kill: collected for a moment (a boss and its escorts, two fighters in
  // one blast), then called out as one line: the biggest of them.
  kill(kind, ref = null) {
    let key = kind;
    if (kind === "ufo" && ref) key = ref.boss ? "boss" : ref.design === "sphere" ? "ball" : ref.size === "mothership" || ref.size === "giant" ? "mothership" : "ufo";
    const p = this._pending || (this._pending = { jets: 0, best: null });
    if (key === "jet") p.jets++;
    else if (!p.best || (RANK[key] ?? 0) > (RANK[p.best] ?? 0)) p.best = key;
    if (!this._timer) this._timer = setTimeout(() => this._flush(), 220);
  }

  _flush() {
    this._timer = null;
    const p = this._pending;
    this._pending = null;
    if (!p) return;
    if (p.jets) this.say(`splash${Math.min(3, p.jets)}`);
    if (p.best) this.say(p.best);
  }

  // Queues a line (by key, or a text of its own: { text }). False if it was
  // not queued (off, unknown, said just now).
  say(key, { text = null } = {}) {
    if (!this.enabled) return false;
    const lines = LINES[key];
    if (!text && !lines) return false;
    const t = now();
    if (t - (this.last[key] ?? -99) < (COOLDOWN[key] ?? 0.8)) return false;
    if (this.queue.some((q) => q.key === key)) return false;
    this.last[key] = t;
    const item = { key, text: text || lines[Math.floor(Math.random() * lines.length)], t };
    if (URGENT.has(key)) this.queue.unshift(item);
    else this.queue.push(item);
    while (this.queue.length > MAX_QUEUE) this.queue.pop();
    if (!this.busy) this._next();
    return true;
  }

  _volume() {
    const v = this.audio?.volumes;
    if (!v) return 0.4;
    return Math.max(0, Math.min(1, (v.master ?? 0.3) * (v.voice ?? 1) * 2.6));
  }

  _synth() {
    if (typeof window === "undefined") return null;
    const s = window.speechSynthesis;
    return s && typeof window.SpeechSynthesisUtterance === "function" ? s : null;
  }

  // An English voice, a man's if there is one (they sound more like a pilot
  // on the radio); null for the browser's default.
  _pickVoice(synth) {
    if (this._voice !== undefined) return this._voice;
    let best = null;
    let bs = -1;
    for (const v of synth.getVoices?.() || []) {
      const lang = String(v.lang || "").toLowerCase();
      if (!lang.startsWith("en")) continue;
      const name = String(v.name || "");
      let s = 1;
      if (/\b(male|daniel|david|alex|fred|george|guy|ryan|mark|james|thomas|arthur|aaron)\b/i.test(name)) s += 3;
      if (/female|zira|susan|samantha|victoria|karen|moira|tessa|hazel|libby|sonia|aria|jenny/i.test(name)) s -= 2;
      if (lang === "en-us" || lang === "en-gb" || lang === "en_us" || lang === "en_gb") s += 1;
      if (/google|natural|neural|online/i.test(name)) s += 1;
      // (An installed voice speaks at once; a network one can lag seconds behind the kill.)
      if (v.localService) s += 2;
      if (s > bs) {
        bs = s;
        best = v;
      }
    }
    // (The list can still be empty on the first call: ask again next time.)
    if (best || (synth.getVoices?.() || []).length) this._voice = best;
    return best;
  }

  _next() {
    const t = now();
    while (this.queue.length && t - this.queue[0].t > STALE) this.queue.shift();
    const item = this.queue.shift();
    if (!item) {
      this.busy = false;
      return;
    }
    this.busy = true;
    this.said.push(item.text);
    if (this.said.length > 20) this.said.shift();
    const vol = this._volume();
    const au = this.audio;
    if (vol <= 0) {
      setTimeout(() => this._next(), 50);
      return;
    }
    au?.playRadio?.(true);
    au?.setRadioHiss?.(true);
    const synth = this._synth();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      au?.setRadioHiss?.(false);
      au?.playRadio?.(false);
      setTimeout(() => this._next(), 320);
    };
    if (!synth) {
      // (No speech here: the radio keys up, a breath of static, and lets go.)
      setTimeout(finish, 380);
      return;
    }
    setTimeout(() => {
      try {
        const u = new window.SpeechSynthesisUtterance(item.text);
        const v = this._pickVoice(synth);
        if (v) u.voice = v;
        u.lang = v?.lang || "en-US";
        u.rate = 1.15;
        u.pitch = 0.75;
        u.volume = vol;
        u.onend = finish;
        u.onerror = finish;
        // (A line still in the browser's own queue, past STALE and MAX_QUEUE
        // (a slow network voice, a missed onend): this one replaces it.)
        if (synth.speaking || synth.pending) synth.cancel();
        synth.speak(u);
      } catch {
        finish();
      }
      // (Some browsers never say they are done: the line's own length, then on.)
      setTimeout(finish, 1400 + item.text.length * 70);
    }, 70);
  }

  // Everything still waiting is dropped (a new game, the menu).
  clear() {
    this.queue.length = 0;
    this._pending = null;
    try {
      this._synth()?.cancel?.();
    } catch {
      // (nothing to cancel)
    }
  }
}

export const voice = new PilotVoice();
