// A probe scenario (tools/probe.mjs): the Round 22 aircraft (js/plane-models.js)
// from the side, the top, the front and three-quarters, in the air and
// parked on their gear, with their moving parts (props, the F-14's sweep,
// the F-35B's hover nozzle and doors, the A-10's split brakes).
//
//   node tools/probe.mjs tools/r22-plane-views.mjs --preset=high --out=dir [--types=a10,f35]
export default async function ({ shot, frames, v }) {
  const args = { types: process.argv.find((a) => a.startsWith("--types="))?.slice(8) };
  const types = String(args?.types || "a10,f35,su57,f14,p51,ac130").split(",");
  for (const type of types) {
    await v((g, type) => {
      const THREE = g.THREE;
      g.player.setMode("creative");
      g.sky.locked = true;
      g.sky.setSunAngle(Math.PI * 0.36);
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      const p = g.player.position;
      const y = Math.max(g.world.heightAt(Math.floor(p.x), Math.floor(p.z)), 63) + 60;
      const j = g.vehicles.create("jet", { jetType: type, pos: [p.x, y, p.z], yaw: 0, airborne: true, speed: 0, throttle: 0 });
      g.vehicles.enter(j);
      const big = { a10: 0.6, f35: 0.55, su57: 0.68, f14: 0.68, p51: 0.42, ac130: 1.3 }[type] ?? 0.6;
      window.__pv = { j, off: new THREE.Vector3(30, 0, 0), look: new THREE.Vector3(0, 0, 0), gear: 0, ab: false, throttle: 0.6, sweep: 0.35, nozzle: 0, brake: 0, big, onGround: false, speed: 120 };
      const S = window.__pv;
      j.update = function (dt) {
        this.time += dt;
        this.vel.set(0, 0, 0);
        this._place();
        this.model.setThrottle(S.throttle, S.ab, this.time);
        this.model.setLights(this.time, 0, true);
        this.model.setGear(S.gear);
        this.model.update?.({ running: true, throttle: S.throttle, speed: S.speed, onGround: S.onGround, stall: 30, sweep: S.sweep, nozzle: S.nozzle, stores: { bombs: 2, rockets: 6 } }, dt);
        this.model.setControls?.(0, 0, 0, S.brake);
      };
      j.updateCamera = function (camera) {
        camera.position.copy(S.off).multiplyScalar(S.big).applyQuaternion(this.q).add(this.pos);
        camera.up.set(0, 1, 0);
        camera.lookAt(S.look.clone().applyQuaternion(this.q).add(this.pos));
      };
      if (!document.body.classList.contains("hud-off")) g.toggleHud();
      return true;
    }, type);
    const view = async (name, off, look = [0, 0, 0], extra = {}) => {
      await v((g, a) => {
        const S = window.__pv;
        S.off.fromArray(a.off);
        S.look.fromArray(a.look);
        Object.assign(S, a.extra);
      }, { off, look, extra });
      await frames(14);
      await shot(`${type}-${name}`);
    };
    await view("three-quarter", [17, 6, -17], [0, 0, 1]);
    await view("side", [26, 0.4, 0.5]);
    await view("top", [0, 30, 0.4]);
    await view("front", [0, 1.5, -24]);
    await view("rear", [13, 5, 19], [0, 0, 2], { ab: true, throttle: 1 });
    if (type === "f14") await view("swept", [0, 30, 0.4], [0, 0, 0], { sweep: 1.19, ab: false, throttle: 0.6 });
    if (type === "f35") await view("hover", [14, 3, -14], [0, 0, 0], { nozzle: 1, gear: 1, ab: false, throttle: 0.7 });
    if (type === "a10") await view("brakes", [14, 4, 14], [0, 0, 0], { brake: 1, ab: false, throttle: 0.5 });
    await view("parked", [14, 1, -13], [0, -0.6, 0], { gear: 1, ab: false, throttle: 0, onGround: true, speed: 0, sweep: type === "f14" ? 1.31 : 0.35, brake: 0 });
  }
}
