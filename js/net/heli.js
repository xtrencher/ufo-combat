// (Round 14) The helicopters online (js/vehicle-heli.js, js/helis.js). The
// helicopters themselves and the aliens' gunships are shared vehicles
// (net/vehicles.js: the owner flies, the others draw a puppet from its
// states: the attitude, the rotor, the gun's turret, the stores); their
// tracers, rockets, missiles and blasts reach everyone as any vehicle's
// (net/fx.js). The host runs the gunships' AI against every player. This
// module adds what those don't carry. Messages (an older peer has no
// handler and ignores them):
//   "hkill" { k, at }  (host to a guest) the guest's shot brought one of the
//                      aliens' gunships down: their stats, the callout
// and a helicopter's flares go out as a jet's do (net/fx.js "f": the other
// machines' missiles see them, and draw them).
import { Heli } from "../vehicle-heli.js";
import { voice } from "../voice.js";

const r2 = (v) => Math.round(v * 100) / 100;

export class HeliSync {
  constructor(mp, war) {
    this.mp = mp;
    this.net = mp.net;
    this.game = mp.game;
    this.war = war;
    if (!war) return;
    war.onRemoteKill = (pid, u) => {
      if (this.mp.active && this.net.isHost) this.net.send(pid, { t: "hkill", k: u.type, at: [r2(u.pos.x), r2(u.pos.y), r2(u.pos.z)] });
    };
    this.net.on("hkill", (m, from) => this._onKill(m, from));
    // A helicopter of ours lets its flares go: sent like a jet's.
    const self = this;
    const launch = Heli.prototype._launchFlares;
    if (!Heli.prototype._netFlares) {
      Heli.prototype._netFlares = true;
      Heli.prototype._launchFlares = function () {
        launch.call(this);
        if (!this.puppet && self.mp.active && this.net) self.mp.fx?.flares?.(this);
      };
    }
  }

  start() {
    const w = this.war;
    if (!w) return;
    if (this.net.isHost) w.puppets = false;
    else {
      // A guest: the host's gunships come as puppets; its own go.
      w.puppets = true;
      for (const u of w.units) w.vehicles.remove(u);
    }
  }

  stop() {
    const w = this.war;
    if (!w) return;
    w.puppets = false;
    w.enabled = true;
  }

  update() {
    // (A Dogfight has no gunships.)
    if (this.war) this.war.enabled = this.mp.mode !== "dogfight";
  }

  // (A guest) the host says our shot brought a gunship down.
  _onKill(m) {
    if (this.net.isHost || typeof m.k !== "string") return;
    const g = this.game;
    g.stats?.add?.("gunshipsDown");
    g.toast?.("GUNSHIP DOWN!", 2.5);
    try {
      voice.say("heli", { text: "Helicopter down!" });
    } catch {}
  }
}
