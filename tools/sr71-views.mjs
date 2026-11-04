// A probe scenario (tools/probe.mjs): the SR-71 Blackbird from the side,
// the top, the front, three-quarters front and back (afterburner lit) in
// the air, and parked on its gear.
//
//   node tools/probe.mjs tools/sr71-views.mjs --preset=high --out=dir
export default async function ({ assert, shot, frames, v }) {
  const r = await v(async (g) => {
    const THREE = g.THREE;
    g.player.setMode("creative");
    g.sky.locked = true;
    g.sky.setSunAngle(Math.PI * 0.36);
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    const p = g.player.position;
    const y = Math.max(g.world.heightAt(Math.floor(p.x), Math.floor(p.z)), 63) + 60;
    const j = g.vehicles.create("jet", { jetType: "sr71", pos: [p.x, y, p.z], yaw: 0, airborne: true, speed: 0, throttle: 0 });
    g.vehicles.enter(j);
    window.__sr = { j, off: new THREE.Vector3(30, 0, 0), look: new THREE.Vector3(0, 0, 0), gear: 0, ab: false, throttle: 0, heat: 0 };
    const S = window.__sr;
    j.update = function (dt) {
      this.time += dt;
      this.vel.set(0, 0, 0);
      this._place();
      this.model.setThrottle(S.throttle, S.ab, this.time);
      this.model.setLights(this.time, 0, true);
      this.model.setGear(S.gear);
      this.model.setHeat?.(S.heat, this.time);
      this.model.setControls?.(0, 0, 0, 0);
    };
    j.updateCamera = function (camera) {
      camera.position.copy(S.off).applyQuaternion(this.q).add(this.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(S.look.clone().applyQuaternion(this.q).add(this.pos));
    };
    if (!document.body.classList.contains("hud-off")) g.toggleHud();
    const { sr71Triangles } = await import("./js/sr71-model.js");
    return { tris: sr71Triangles(), y };
  });
  console.log(`  triangles: ${r.tris}`);
  assert(r.tris > 3000 && r.tris < 40000, `triangles ${r.tris}`);
  const view = async (name, off, look = [0, 0, 0], extra = {}) => {
    await v((g, a) => {
      const S = window.__sr;
      S.off.fromArray(a.off);
      S.look.fromArray(a.look);
      Object.assign(S, a.extra);
    }, { off, look, extra });
    await frames(12);
    await shot(name);
  };
  await view("side", [28, 0.6, 0.6]);
  await view("top", [0, 34, 0.4]);
  await view("front", [0, 1.2, -24]);
  await view("three-quarter", [17, 7, -17], [0, 0, 1]);
  await view("rear-ab", [13, 4, 19], [0, 0, 3], { ab: true, throttle: 1, heat: 1 });
  await view("cockpit", [3.2, 2.2, -12.5], [0, 0.6, -8.5], { ab: false, throttle: 0.3, heat: 0 });
  await view("gear", [12, -1.2, -12], [0, -0.6, 0], { gear: 1 });
}
