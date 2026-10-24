// Creative's vehicles (Round 13): the items of the Creative palette's
// Vehicles tab, one per thing to fly: the F-22 Raptor, the F-16 Fighting
// Falcon, the B-2 Spirit and a UFO (each one placed is the next design).
// Right click puts it on the ground aimed at (F to board), or, aimed at the
// sky, you straight into it up in the air. Creative only, in either world
// type (a Survival world has no Mods, but has these); never crafted, never
// dropped by anything. Placing is the vehicles' (js/vehicles.js sets
// LIB.summonVehicle; `vehicle` is the key of VehicleManager.summons).
// Ids: the core item range's unused 266-269; 316-319 are kept for more
// vehicles (the tanks).
import { LIB } from "./base.js";

export const F22_ITEM = 266;
export const F16_ITEM = 267;
export const B2_ITEM = 268;
export const UFO_ITEM = 269;
// (Round 13) The ground war's (js/vehicle-tank.js, js/ballistic.js).
export const TIGER_ITEM = 316;
export const MBT_ITEM = 317;
export const TEL_ITEM = 318;

export const items = {
  [F22_ITEM]: { name: "F-22 Raptor", icon: "vehicle_f22", stack: 1, vehicle: "f22" },
  [F16_ITEM]: { name: "F-16 Fighting Falcon", icon: "vehicle_f16", stack: 1, vehicle: "f16" },
  [B2_ITEM]: { name: "B-2 Spirit", icon: "vehicle_b2", stack: 1, vehicle: "b2" },
  [UFO_ITEM]: { name: "UFO", icon: "vehicle_ufo", stack: 1, vehicle: "ufo" },
  [TIGER_ITEM]: { name: "Tiger Tank", icon: "vehicle_tiger", stack: 1, vehicle: "tiger" },
  [MBT_ITEM]: { name: "Battle Tank", icon: "vehicle_mbt", stack: 1, vehicle: "mbt" },
  [TEL_ITEM]: { name: "Missile Launcher (TEL)", icon: "vehicle_tel", stack: 1, vehicle: "tel" },
};

export const itemUse = {};
for (const [id, def] of Object.entries(items)) itemUse[id] = (ctx) => !!LIB.summonVehicle?.(ctx, def.vehicle);

// ---------- Icons ----------

export const icons = {};
// A fighter seen from above, nose up: the fuselage, swept wings, the
// tailplanes and the fins (two on the Raptor, one on the Falcon), the canopy.
function fighterIcon(kit, f16) {
  const c = new kit.Canvas();
  const BODY = 0;
  const DARK = 1;
  const GLASS = 2;
  if (f16) {
    c.poly(BODY, [[16, 3], [17.6, 9], [17.6, 14], [29, 21], [29, 23], [17.6, 21], [18.5, 25], [22.5, 28.5], [22.5, 30], [16, 28.5], [9.5, 30], [9.5, 28.5], [13.5, 25], [14.4, 21], [3, 23], [3, 21], [14.4, 14], [14.4, 9]], (x) => (x < 16 ? 0.25 : -0.1));
    c.line(DARK, 16, 20, 16, 29.5, 1.4, () => -0.2); // (the fin, seen edge on)
  } else {
    c.poly(BODY, [[16, 2.5], [18.2, 9], [18.6, 13], [29.5, 20.5], [29.5, 22.5], [19, 22.5], [19.5, 24], [25, 28], [25, 30], [16, 28], [7, 30], [7, 28], [12.5, 24], [13, 22.5], [2.5, 22.5], [2.5, 20.5], [13.4, 13], [13.8, 9]], (x) => (x < 16 ? 0.25 : -0.1));
    c.line(DARK, 13.2, 21, 11.6, 27, 1.3, () => -0.2); // (the canted fins)
    c.line(DARK, 18.8, 21, 20.4, 27, 1.3, () => -0.2);
  }
  c.poly(GLASS, [[16, 6], [17.1, 8.5], [16.9, 12], [15.1, 12], [14.9, 8.5]], (x, y) => (y < 9 ? 0.6 : 0));
  const body = f16 ? kit.ramp(0x4e565e, 0x6c757e, 0x8b949c, 0xaab2b9, 0xc8ced3) : kit.ramp(0x3b4048, 0x535a63, 0x6c747d, 0x878f98, 0xa3aab2);
  const dark = kit.ramp(0x22262b, 0x2f343a, 0x3d434a, 0x4c535b, 0x5b636b);
  const glass = kit.ramp(0x5a3d0a, 0x8a6114, 0xb88b22, 0xdcb240, 0xf3d777);
  return c.render([body, dark, glass], [18, 20, 24]);
}
icons.vehicle_f22 = (kit) => fighterIcon(kit, false);
icons.vehicle_f16 = (kit) => fighterIcon(kit, true);
// The B-2 from above: the flying wing with its sawtooth trailing edge, the
// cockpit windows on the hump.
icons.vehicle_b2 = (kit) => {
  const c = new kit.Canvas();
  const WING = 0;
  const HUMP = 1;
  const GLASS = 2;
  c.poly(WING, [[16, 7], [31, 22], [27.5, 25], [23.5, 21.5], [20, 25], [16, 21.5], [12, 25], [8.5, 21.5], [4.5, 25], [1, 22]], (x, y) => (y < 14 ? 0.3 : x < 16 ? 0.1 : -0.15));
  c.poly(HUMP, [[16, 8.5], [19.5, 14], [18.5, 19], [13.5, 19], [12.5, 14]], () => 0.2);
  c.poly(GLASS, [[14.4, 11.8], [17.6, 11.8], [17.9, 13], [14.1, 13]], () => 0.4);
  const wing = kit.ramp(0x202226, 0x2c2f34, 0x3a3e44, 0x4a4f56, 0x5d636b);
  const hump = kit.ramp(0x26292e, 0x33373d, 0x42474e, 0x545a62, 0x676e77);
  const glass = kit.ramp(0x0e1a24, 0x1a2e3e, 0x2a4a60, 0x426c86, 0x6a96ae);
  return c.render([wing, hump, glass], [10, 10, 12]);
};
// A saucer from the side: the silver disc, its glowing rim lights and the dome.
icons.vehicle_ufo = (kit) => {
  const c = new kit.Canvas();
  const HULL = 0;
  const DOME = 1;
  const LIGHT = 2;
  c.disc(DOME, 16, 13.5, 6.5, 6, (x, y) => (x < 14 && y < 11 ? 0.6 : 0));
  c.disc(HULL, 16, 18.5, 14.5, 4.6, (x, y) => (y < 17 ? 0.45 : y > 20.5 ? -0.45 : 0));
  for (const x of [6, 11, 16, 21, 26]) c.disc(LIGHT, x, 19, 1.3, 1.1, () => 0.5);
  const hull = kit.ramp(0x4a5058, 0x6d747c, 0x939aa2, 0xbac0c6, 0xdfe3e7);
  const dome = kit.ramp(0x1d4f5e, 0x2c7488, 0x45a0b4, 0x74c8d6, 0xb4ecf2);
  const light = kit.ramp(0x2d7a2a, 0x47a83f, 0x6cd65e, 0xa0f28c, 0xd8ffc8);
  return c.render([hull, dome, light], [16, 18, 22]);
};

// (Round 13) A tank from the side: the tracks and road wheels, the hull, the
// turret and the long gun (the Tiger boxy and grey, the modern tank low and green).
function tankIcon(kit, tiger) {
  const c = new kit.Canvas();
  const BODY = 0;
  const TRACK = 1;
  const WHEEL = 2;
  c.poly(TRACK, [[3, 21], [29, 21], [27, 27.5], [5, 27.5]], () => -0.1);
  for (const x of tiger ? [7, 11, 15, 19, 23, 26] : [7, 11.5, 16, 20.5, 25]) c.disc(WHEEL, x, 24.3, 2, 2, (px, py) => (py < 24 ? 0.4 : -0.2));
  if (tiger) {
    c.poly(BODY, [[2, 15.5], [30, 15.5], [30, 21], [2, 21]], (x, y) => (y < 17 ? 0.35 : 0));
    c.poly(BODY, [[9, 10], [22, 10], [23, 15.5], [8, 15.5]], (x, y) => (y < 12 ? 0.45 : 0.1));
    c.line(BODY, 8, 12.5, 0.5, 12.5, 1.4, () => 0.2);
    c.disc(TRACK, 1.2, 12.5, 1.3, 1.4, () => 0);
  } else {
    c.poly(BODY, [[1.5, 18.5], [6, 15.5], [30, 15.5], [30, 21], [3, 21]], (x, y) => (y < 17 ? 0.35 : 0));
    c.poly(BODY, [[7, 12.5], [13, 10.5], [25, 10.5], [26, 15.5], [9, 15.5]], (x, y) => (y < 12.5 ? 0.45 : 0.1));
    c.line(BODY, 9, 12.5, 0.5, 12.5, 1.2, () => 0.2);
  }
  const body = tiger ? kit.ramp(0x2a2e31, 0x3a3f43, 0x4d5357, 0x646b70, 0x80878c) : kit.ramp(0x2b311d, 0x3c4429, 0x4f5936, 0x667146, 0x7f8b58);
  const track = kit.ramp(0x141312, 0x1f1d1b, 0x2b2825, 0x3a3632, 0x4a4540);
  const wheel = kit.ramp(0x1c1c1c, 0x2e2e2e, 0x444444, 0x5e5e5e, 0x7a7a7a);
  return c.render([body, track, wheel], [14, 16, 18]);
}
icons.vehicle_tiger = (kit) => tankIcon(kit, true);
icons.vehicle_mbt = (kit) => tankIcon(kit, false);
// The missile truck: the cab, the long bed on eight wheels, the white missile raised a little.
icons.vehicle_tel = (kit) => {
  const c = new kit.Canvas();
  const BODY = 0;
  const WHEEL = 1;
  const MISSILE = 2;
  c.poly(BODY, [[1.5, 16], [7.5, 16], [8, 22.5], [1.5, 22.5]], (x, y) => (y < 18 ? 0.35 : 0));
  c.poly(BODY, [[7.5, 19.5], [30.5, 19.5], [30.5, 23], [7.5, 23]], () => 0.1);
  c.poly(MISSILE, [[6, 16.5], [27, 12.5], [27.8, 14.2], [6.8, 18.2]], (x, y) => (y < 15 ? 0.4 : 0));
  c.poly(BODY, [[3, 14.5], [6.5, 16.2], [6.9, 18.2], [3.2, 17]], () => 0.5);
  for (const x of [5, 10, 21, 26]) c.disc(WHEEL, x, 24.5, 2.3, 2.3, (px, py) => (py < 24 ? 0.4 : -0.2));
  const body = kit.ramp(0x2b311d, 0x3c4429, 0x4f5936, 0x667146, 0x7f8b58);
  const wheel = kit.ramp(0x111111, 0x1d1d1d, 0x2c2c2c, 0x3e3e3e, 0x525252);
  const missile = kit.ramp(0x8e8c84, 0xaeaca4, 0xcac8c0, 0xe0ded6, 0xf6f4ee);
  return c.render([body, wheel, missile], [14, 16, 20]);
};
