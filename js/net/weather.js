// The weather online (Round 11): the host's (js/weather.js). The host sends
// its rain and thunder when they turn ("weather", and again every 15 s for
// anyone who missed it), with its levels to a player joining (the state
// sync), and every lightning bolt ("bolt"): each guest draws and hears it,
// and is hurt by it if it is near them (the host has already lit the fires
// and hurt its creatures). A guest's weather only fades toward the host's.
// Older peers ignore both messages.
const RESEND = 15;
const cell = (v) => Number.isInteger(v) && Math.abs(v) < 1e7;

export class WeatherSync {
  constructor(mp, weather) {
    this.mp = mp;
    this.net = mp.net;
    this.weather = weather;
    this._t = 0;
    this._sig = "";
    if (!weather) return;
    // (A guest's page never owns the weather, not even before its session starts.)
    if (mp.game.GUEST) weather.authority = false;
    const strike = weather.onStrike;
    weather.onStrike = (x, y, z) => {
      strike?.(x, y, z);
      if (this.net.active && this.net.isHost) this.net.broadcast({ t: "bolt", p: [x, y, z] });
    };
    const change = weather.onChange;
    weather.onChange = () => {
      change?.();
      if (this.net.active && this.net.isHost) this._send();
    };
    this.net.on("weather", (m) => !this.net.isHost && this.weather.applyNet(m));
    this.net.on("bolt", (m) => {
      if (this.net.isHost || !Array.isArray(m.p) || !m.p.every(cell)) return;
      this.weather.strike(m.p[0], m.p[1], m.p[2]);
    });
    this.net.registerSync("weather", {
      save: () => this.weather.netState(),
      load: (m) => this.weather.applyNet(m, true),
    });
  }

  start() {
    if (!this.weather) return;
    this.weather.authority = this.net.isHost;
    this._sig = "";
  }

  stop() {
    // (The host plays on alone; a guest's page goes back to the menu.)
    if (this.weather && !this.mp.game.GUEST) this.weather.authority = true;
  }

  _send() {
    const m = this.weather.netState();
    this._sig = `${m.r}${m.th}`;
    this._t = RESEND;
    this.net.broadcast({ t: "weather", ...m });
  }

  update(dt) {
    // (A Missions world's sky is always clear: nothing to send.)
    if (!this.weather || !this.net.isHost || !this.weather.enabled()) return;
    this._t -= dt;
    if (this._t <= 0 || `${+this.weather.raining}${+this.weather.thundering}` !== this._sig) this._send();
  }
}
