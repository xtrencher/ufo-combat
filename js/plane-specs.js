// (Round 22) The new aircraft's numbers (js/vehicle-jet.js adds them to
// JET_TYPES; plain data, no three.js: Node tests read it as is). Each one
// flies on the jet's flight model with its own settings (multipliers of
// Settings > Vehicles, as the F-16's and the B-2's are) and its own
// features, read by js/plane-features.js:
//   a10   A-10C Thunderbolt II: slow and very tough, short takeoffs, the
//         GAU-8 (a huge, hard-hitting gatling, BRRRT), bombs, rockets and
//         Maverick missiles; no afterburner.
//   f35   F-35B Lightning II: stealthy (radar and UFO aim struggle with it),
//         V converts to the hover (STOVL: the nozzle swivels down, the lift
//         fan's doors open): vertical takeoffs and landings.
//   su57  Su-57: the most agile, thrust vectoring (control at low speed and
//         past the stall: tight turns, post-stall manoeuvres), the fastest
//         fighter.
//   f14   F-14D Tomcat: the wings sweep with the Mach number (V: auto /
//         forward / back), long-range Phoenix missiles in salvos of six,
//         two seats.
//   p51   P-51D Mustang: a WWII propeller fighter, six .50 calibre guns, two
//         bombs and six HVAR rockets; no missiles, nuke or laser; Shift is
//         war emergency power; a taildragger.
//   ac130 AC-130J Ghostrider: a gunship (ten aboard), four turboprops, side
//         guns firing out of the left; V orbits the point in the crosshair
//         (a pylon turn round it, the gunner's view looking down at it).
// Sizes and the gear in blocks (the models in metres, K = 15.2 / 18.9).

export const K = 15.2 / 18.9;

export const PLANE_TYPES = {
  a10: { id: "a10", name: "A-10 Thunderbolt II", short: "tough ground attack jet (the GAU-8)", takeoff: "about 75 blocks", maxHealth: 420, speed: 0.7, stall: 0.6, accel: 0.85, turn: 1.0, roll: 0.85, cannonRate: 50, cannonDamage: 7, heatPerShot: 0.0115, salvo: 2, salvoTime: 2, missileCooldown: 0.6, probes: { nose: 6.8, wing: 7.05, tail: 6.45 }, gear: 1.657, touchPitch: 0.4, radius: 8, hitRadius: 6, mass: 2.2, seat: [0, 0.86, -3.7], nuke: false, ab: false, gun: "gau8", weapons: ["missile", "rockets", "bombs", "mininuke", "laser"], bombs: 6, rockets: 38, miniAmmo: 2, missileName: "MAVERICK", engine: "fan", groundThrust: 1.25, enterRadius: 6.5, camBack: 26, camUp: 6 },
  f35: { id: "f35", name: "F-35B Lightning II", short: "stealth fighter with a hover (V)", takeoff: "about 150 blocks (100 with the afterburner), or straight up in the hover (V)", maxHealth: 150, speed: 0.86, stall: 0.95, accel: 1.05, turn: 1.02, roll: 1.1, cannonRate: 18, cannonDamage: 5, heatPerShot: 0.048, salvo: 2, salvoTime: 2, missileCooldown: 0.45, probes: { nose: 6.3, wing: 4.3, tail: 6.1 }, gear: 1.4, radius: 7, hitRadius: 5, mass: 1.3, seat: [0, 0.72, -3.05], nuke: false, ab: true, mach: 1.2, weapons: ["missile", "super", "bombs", "mininuke", "laser"], bombs: 4, miniAmmo: 2, stealth: 0.6, hover: true, enterRadius: 6 },
  su57: { id: "su57", name: "Su-57", short: "agile thrust-vectoring fighter", takeoff: "about 140 blocks (90 with the afterburner)", maxHealth: 150, speed: 1.05, stall: 0.8, accel: 1.2, turn: 1.35, roll: 1.55, cannonRate: 25, cannonDamage: 6, heatPerShot: 0.042, salvo: 4, salvoTime: 3, missileCooldown: 0.4, probes: { nose: 8.3, wing: 5.7, tail: 7.95 }, gear: 1.79, radius: 9, hitRadius: 6, mass: 1.5, seat: [0, 0.76, -4.7], nuke: false, ab: true, mach: 1.35, miniAmmo: 2, tvc: true, enterRadius: 7, camBack: 27, camUp: 6 },
  f14: { id: "f14", name: "F-14 Tomcat", short: "swing-wing fighter, long-range missiles", takeoff: "about 150 blocks (100 with the afterburner)", maxHealth: 175, speed: 1.02, stall: 0.8, accel: 0.95, turn: 0.95, roll: 0.85, cannonRate: 16, cannonDamage: 5, heatPerShot: 0.05, salvo: 6, salvoTime: 4, missileCooldown: 0.6, probes: { nose: 8.3, wing: 6.0, tail: 7.1 }, gear: 1.415, radius: 9, hitRadius: 6.2, mass: 1.8, seat: [0, 0.82, -4.55], nuke: false, ab: true, mach: 1.3, miniAmmo: 2, sweep: true, missileName: "PHOENIX", lockRange: 1.6, missileLife: 1.6, enterRadius: 7, camBack: 27, camUp: 6 },
  p51: { id: "p51", name: "P-51 Mustang", short: "WWII propeller fighter", takeoff: "about 60 blocks", maxHealth: 100, speed: 0.6, stall: 0.5, accel: 0.9, turn: 1.1, roll: 1.2, cannonRate: 24, cannonDamage: 2.6, heatPerShot: 0.03, salvo: 1, salvoTime: 99, missileCooldown: 1, probes: { nose: 3.95, wing: 4.55, tail: 3.95 }, gear: 1.544, touchPitch: 0.5, radius: 5.5, hitRadius: 4, mass: 0.5, seat: [0, 0.78, 0.3], nuke: false, ab: true, missiles: false, weapons: ["bombs", "rockets"], bombs: 2, rockets: 6, prop: "piston", gun: "m2", groundThrust: 1.1, enterRadius: 5, camBack: 15, camUp: 4, sit: 0.19 },
  ac130: { id: "ac130", name: "AC-130J Ghostrider", short: "gunship: side guns, orbit a target (V)", takeoff: "about 110 blocks", maxHealth: 600, speed: 0.5, stall: 0.62, accel: 0.6, turn: 0.3, roll: 0.38, cannonRate: 18, cannonDamage: 6, heatPerShot: 0.022, salvo: 1, salvoTime: 99, missileCooldown: 1.2, probes: { nose: 12.4, wing: 16.25, tail: 12 }, gear: 2.68, touchPitch: 0.3, radius: 20, hitRadius: 12, mass: 7, seat: [-0.44, 0.72, -10.7], nuke: false, ab: false, weapons: ["gun40", "gun105", "missile", "mininuke", "laser"], miniAmmo: 3, missileName: "GRIFFIN", prop: "turboprop", gun: "side25", orbit: true, maxBank: 0.6, maxG: 1.7, groundThrust: 1.45, enterRadius: 11, camBack: 50, camUp: 11, sideLaser: true },
};

// The wheels (GEAR_LAYOUT in vehicle-jet.js: blocks): the nose wheel ahead
// of the middle, the main wheels behind it and their half track. (The
// P-51's main wheels are ahead of the middle: mainB < 0; its "nose wheel"
// is a point under the engine, for the ground's slope.)
export const PLANE_GEAR = {
  a10: { noseF: 4.02, mainB: 0.24, track: 2.11 },
  f35: { noseF: 4.18, mainB: 0.72, track: 1.25 },
  su57: { noseF: 4.58, mainB: 0.76, track: 1.57 },
  f14: { noseF: 5.31, mainB: 1.0, track: 2.05 },
  p51: { noseF: 2.4, mainB: -0.92, track: 1.45 },
  ac130: { noseF: 9.65, mainB: 0.24, track: 1.77 },
};

// Where the laser leaves (forward, up: blocks; the AC-130's from its left side, see sideLaser).
export const PLANE_LASER = { a10: [6.3, -0.55], f35: [5.9, -0.5], su57: [7.8, -0.45], f14: [7.9, -0.55], p51: [3.6, -0.7], ac130: [4.0, -0.7] };

// Seats (Round 18's seat counts; the pilot's included).
export const PLANE_SEATS = { a10: 1, f35: 1, su57: 1, f14: 2, p51: 1, ac130: 10 };

// The guns (the left button) by kind: the rounds' look and punch.
//   gau8   the A-10's 30 mm: big orange tracers, every few a small flash of HEI on what it hits.
//   m2     the P-51's six .50 calibre guns: small tracers from the wings, converging ahead.
//   side25 the AC-130's 25 mm gatling, out of the left side (at the gunner's aim).
export const PLANE_GUNS = {
  gau8: { speed: 760, radius: 0.12, length: 12, spread: 0.006, range: 1300, color: [6, 3.6, 1.2], sound: 4 },
  m2: { speed: 700, radius: 0.06, length: 7, spread: 0.01, range: 900, color: [5, 3.8, 1.6], sound: 2, wings: [1.8, 2.0, 2.2] },
  side25: { speed: 820, radius: 0.08, length: 9, spread: 0.004, range: 1600, color: [6, 3.4, 1.0], sound: 2 },
};

// The new right-button weapons.
// rockets: unguided, a pair a click (held: a ripple), a small blast each.
// bombs: free-fall, a click drops one (held: one every `interval`), a big
//   blast where it lands; the HUD's pipper shows where.
// gun40 / gun105: the AC-130's side guns (40 mm Bofors, 105 mm howitzer):
//   explosive shells at the gunner's aim.
export const ROCKETS = { speed: 430, damage: 70, radius: 3.2, interval: 0.12, life: 5, reload: 45 };
export const BOMBS = { damage: 300, radius: 7.5, interval: 0.3, reload: 60, drag: 0.04 };
export const SIDE_GUNS = {
  gun40: { name: "40 MM", rate: 2.2, speed: 640, damage: 45, blast: 2.8, range: 2000 },
  gun105: { name: "105 MM", rate: 1 / 3.2, speed: 520, damage: 320, blast: 8, range: 2400 },
};
// The P-51's own: a 500 lb bomb, the HVAR (heavier than the A-10's rockets).
export const P51_BOMB = { radius: 6.5, damage: 240 };
export const HVAR = { radius: 4.2, damage: 110 };

// (Round 22) The F-35B's hover, the F-14's sweep, the AC-130's orbit.
export const HOVER = {
  enter: 2.4, // x the stall speed: slower than this V converts to the hover
  convert: 2.6, // seconds for the nozzle to swivel down (or back)
  climb: 14, // blocks/s up (Space) / down (Shift)
  sink: 8, // (under the hard landing's sink rate: a touchdown in the hover is always soft)
  forward: 32, // blocks/s forward (W), back (S) 10, sideways (Q / E) 14
  back: 10,
  side: 14,
  decel: 14, // blocks/s^2: how fast the hover takes the speed off
  pitch: 0.35, // the most the nose follows the mouse up or down in the hover (radians)
};
export const SWEEP = { fwd: 0.349, back: 1.187, parked: 1.31, m0: 0.55, m1: 0.95, rate: 0.5 }; // (radians: 20, 68, 75 degrees; the Mach from which it sweeps, to fully back; rad/s)
export const ORBIT = { radius: 300, minR: 180, maxR: 650, speed: 72, minAgl: 110, bank: 0.55, look: 0.6 };

// (Round 22) The hit shapes (js/hitboxes.js buildPlane), in metres as the
// models: the fuselage's sections [z, half width, height above, below, the
// centre's height], pods [x, y, z0, z1, radius] (nacelles, gear pods,
// mirrored when x is not 0), lifting plates { out: [[x, z]] (the right
// one's outline; mirrored), y0, y1 } and fins { h (height), z0, z1 (at the
// root), t0, t1 (at the tip), x, y (the root's middle), cant (radians out),
// mirror }. (The F-14's wings at mid sweep.)
export const PLANE_HULLS = {
  a10: {
    body: [[-8.5, 0.15, 0.2, 0.4, -0.25], [-7.5, 0.62, 0.62, 0.55, -0.12], [-5.0, 0.9, 1.4, 0.82, 0], [-1.4, 0.9, 0.92, 0.9, 0], [3.5, 0.62, 0.68, 0.6, 0.15], [8.05, 0.1, 0.1, 0.1, 0.55]],
    pods: [[1.62, 1.28, 0.25, 4.6, 0.68], [2.62, -0.75, -2.9, 1.2, 0.5]],
    wings: [{ out: [[0.9, -1.4], [8.78, -0.95], [8.78, 0.45], [0.9, 1.65]], y0: -0.65, y1: 0.1 }, { out: [[0, 6.05], [2.95, 6.15], [2.95, 7.95], [0, 8.03]], y0: 0.48, y1: 0.62 }],
    fins: [{ h: 3.1, z0: 6.0, z1: 7.9, t0: 6.55, t1: 7.5, x: 2.95, y: -0.62, cant: 0, mirror: true }],
  },
  f35: {
    body: [[-7.8, 0.05, 0.05, 0.05, -0.1], [-6.0, 0.62, 0.52, 0.45, -0.05], [-3.8, 0.95, 1.18, 0.62, 0], [-1.0, 1.72, 0.85, 0.78, 0], [3.0, 1.55, 0.68, 0.72, 0], [6.6, 0.64, 0.5, 0.5, 0], [7.7, 0.55, 0.5, 0.5, 0]],
    pods: [],
    wings: [{ out: [[1.5, -1.25], [5.35, 1.25], [5.35, 2.6], [1.5, 3.7]], y0: -0.08, y1: 0.12 }, { out: [[1.0, 4.4], [3.4, 5.85], [3.4, 7.35], [1.0, 7.4]], y0: -0.06, y1: 0.08 }],
    fins: [{ h: 2.3, z0: 3.55, z1: 6.6, t0: 5.25, t1: 6.5, x: 1.15, y: 0.55, cant: 0.44, mirror: true }],
  },
  su57: {
    body: [[-10.5, 0.05, 0.05, 0.05, 0.1], [-7.8, 0.64, 0.55, 0.47, 0.12], [-5.0, 0.88, 1.12, 0.52, 0.08], [-2.0, 2.15, 0.58, 0.33, 0.05], [2.5, 2.25, 0.46, 0.3, 0.05], [6.6, 0.85, 0.34, 0.25, 0.08], [9.9, 0.12, 0.1, 0.1, 0.1]],
    pods: [[1.58, -0.48, -3.7, 7.85, 0.6]],
    wings: [{ out: [[2.0, -2.25], [7.05, 3.05], [7.05, 4.6], [2.0, 3.75]], y0: 0.0, y1: 0.24 }, { out: [[0.85, -6.1], [2.6, -2.3], [2.0, -2.25], [0.85, -2.25]], y0: 0.02, y1: 0.22 }, { out: [[2.0, 4.65], [5.1, 6.65], [5.1, 7.95], [2.0, 7.5]], y0: -0.12, y1: 0.03 }],
    fins: [{ h: 2.25, z0: 3.9, z1: 6.55, t0: 5.7, t1: 6.8, x: 2.0, y: 0.32, cant: 0.45, mirror: true }],
  },
  f14: {
    body: [[-10.6, 0.05, 0.05, 0.05, 0], [-7.6, 0.63, 0.62, 0.56, 0.02], [-5.0, 0.76, 1.33, 0.62, 0.02], [-1.0, 1.1, 0.62, 0.42, 0.05], [4.0, 1.2, 0.46, 0.3, 0.06], [8.35, 0.6, 0.1, 0.08, 0.06]],
    pods: [[1.55, -0.25, -3.0, 7.85, 0.64]],
    wings: [{ out: [[0.95, -4.8], [2.95, -0.95], [7.6, 1.6], [7.6, 3.0], [2.95, 1.75], [0.95, 1.6]], y0: 0.1, y1: 0.38 }, { out: [[2.0, 5.05], [5.0, 7.65], [5.0, 8.85], [2.0, 8.6]], y0: -0.3, y1: -0.1 }],
    fins: [{ h: 3.05, z0: 3.15, z1: 6.85, t0: 6.35, t1: 7.7, x: 1.55, y: 0.35, cant: 0.09, mirror: true }],
  },
  p51: {
    body: [[-5.25, 0.08, 0.1, 0.1, 0.1], [-4.55, 0.46, 0.52, 0.52, 0.1], [-1.2, 0.52, 0.68, 0.66, 0.04], [0.4, 0.5, 1.28, 0.72, 0.02], [2.4, 0.36, 0.58, 0.95, 0.02], [4.92, 0.04, 0.05, 0.05, 0.25]],
    pods: [],
    wings: [{ out: [[0.4, -0.85], [5.64, -0.3], [5.64, 0.65], [0.4, 1.8]], y0: -0.62, y1: 0.12 }, { out: [[0, 3.55], [2.05, 3.95], [2.05, 4.75], [0, 5.0]], y0: 0.1, y1: 0.26 }],
    fins: [{ h: 1.55, z0: 3.1, z1: 4.85, t0: 4.45, t1: 4.9, x: 0, y: 0.38, cant: 0, mirror: false }],
  },
  ac130: {
    body: [[-15.4, 0.12, 0.12, 0.12, -0.3], [-14.2, 1.45, 1.5, 1.42, -0.18], [-12.4, 2.05, 2.15, 2.05, 0], [5.0, 2.15, 2.2, 2.3, 0], [10.5, 1.7, 2.0, 0.78, 1.12], [14.95, 0.1, 0.3, 0.1, 2.0]],
    pods: [[5.15, 1.48, -7.1, 3.0, 0.95], [10.25, 1.48, -7.1, 3.0, 0.95], [2.0, -1.45, -3.9, 4.6, 0.9]],
    wings: [{ out: [[1.2, -2.45], [20.2, -1.45], [20.2, 1.0], [1.2, 2.5]], y0: 1.9, y1: 3.2 }, { out: [[0.3, 11.3], [8.0, 12.75], [8.0, 14.65], [0.3, 14.95]], y0: 2.1, y1: 2.35 }],
    fins: [{ h: 6.6, z0: 8.9, z1: 14.5, t0: 12.35, t1: 14.7, x: 0, y: 1.9, cant: 0, mirror: false }],
  },
};
