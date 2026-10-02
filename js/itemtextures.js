// Procedural 32x32 item icons (tools, materials, food) and the block-breaking
// crack overlay, painted in code. Icons are built from simple shapes (thick
// lines, discs, polygons) filled with a material's color ramp, lit from the
// top-left, and outlined in a dark color: the classic item-sprite look.
import { itemInfo } from "./items.js";

const N = 32;

function hex(h) {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

const RAMPS = {
  wood: [0x4a3018, 0x6b4726, 0x8c6035, 0xae7c47, 0xc99a5e].map(hex),
  stone: [0x3e3e43, 0x5a5a61, 0x77777f, 0x95959d, 0xb4b4bb].map(hex),
  iron: [0x5d6166, 0x8d9298, 0xb8bdc3, 0xdadee2, 0xf6f8f9].map(hex),
  diamond: [0x0f6f78, 0x22a9b1, 0x4fd6db, 0x93eff1, 0xdcffff].map(hex),
  gold: [0x8a5d0a, 0xc28a17, 0xe6b52c, 0xf8d95a, 0xfff3b0].map(hex),
  coal: [0x0c0c0e, 0x1a1a1e, 0x2a2a30, 0x44444c, 0x6a6a74].map(hex),
  red: [0x5e0b10, 0x8f141a, 0xc2242a, 0xe5483f, 0xff8c7a].map(hex),
  meat: [0x6e1621, 0xa3293a, 0xcf4b5f, 0xe9798a, 0xf8b3bc].map(hex),
  cooked: [0x3a1d0c, 0x5e3316, 0x87501f, 0xae7336, 0xcf9a5c].map(hex),
  cloth: [0xa8a193, 0xc5bfb1, 0xdcd7cb, 0xefece4, 0xffffff].map(hex),
  leaf: [0x1f5a17, 0x2f7d22, 0x46a034, 0x6cc24c, 0x9be07a].map(hex),
  olive: [0x2a3316, 0x3d4a20, 0x55662e, 0x71843f, 0x93a65a].map(hex),
  gunmetal: [0x1b1d21, 0x2b2e34, 0x40444c, 0x5b6069, 0x7d838c].map(hex),
  leather: [0x2e180b, 0x4f2c14, 0x74421f, 0x9b5f2e, 0xc08545].map(hex),
  grip: [0x24160e, 0x3a2416, 0x543420, 0x6f4730, 0x8a5c3f].map(hex),
  plasma: [0x0b2a5e, 0x1858b8, 0x2f8cf0, 0x7cc4ff, 0xe6f6ff].map(hex),
  amber: [0x5a2a05, 0xa04a0a, 0xe07a14, 0xffb04a, 0xfff0c0].map(hex),
};

class Canvas {
  constructor() {
    this.data = new Uint8ClampedArray(N * N * 4);
    this.mask = new Uint8Array(N * N); // material index + 1 per pixel (0 = empty)
    this.shade = new Float32Array(N * N); // extra brightness per pixel (-1..1)
  }
  // Fills pixels inside `inside(x, y)` with ramp index `mat`, optionally
  // with a per-pixel brightness offset.
  fill(mat, inside, bright = () => 0) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        const i = y * N + x;
        this.mask[i] = mat + 1;
        this.shade[i] = bright(x + 0.5, y + 0.5);
      }
    }
  }
  line(mat, x0, y0, x1, y1, width, bright) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    this.fill(
      mat,
      (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
        const px = x0 + dx * t - x;
        const py = y0 + dy * t - y;
        return px * px + py * py <= (width / 2) * (width / 2);
      },
      bright
    );
  }
  disc(mat, cx, cy, rx, ry = rx, bright) {
    this.fill(mat, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, bright);
  }
  poly(mat, pts, bright) {
    this.fill(
      mat,
      (x, y) => {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      },
      bright
    );
  }
  // Converts the material mask into colors: base ramp level from the shade,
  // lit from the top-left (edges facing up-left brighter, down-right darker),
  // then a dark outline around the whole silhouette.
  render(ramps, outline = [24, 18, 14]) {
    const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : this.mask[y * N + x]);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const m = this.mask[i];
        const o = i * 4;
        if (!m) {
          if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
            this.data[o] = outline[0];
            this.data[o + 1] = outline[1];
            this.data[o + 2] = outline[2];
            this.data[o + 3] = 255;
          }
          continue;
        }
        const ramp = ramps[m - 1];
        let level = 2 + this.shade[i] * 2;
        if (at(x - 1, y - 1) !== m || at(x, y - 1) !== m) level += 1; // top-left edge catches light
        if (at(x + 1, y + 1) !== m || at(x, y + 1) !== m) level -= 1; // bottom-right edge in shade
        const c = ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(level)))];
        this.data[o] = c[0];
        this.data[o + 1] = c[1];
        this.data[o + 2] = c[2];
        this.data[o + 3] = 255;
      }
    }
    return this.data;
  }
}

// Brightness across a thick diagonal (0 at the center line, +/- toward the edges).
function across(x0, y0, x1, y1, amount) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  return (x, y) => (((x - x0) * -dy + (y - y0) * dx) / len) * amount;
}

// Tools: handle from bottom-left toward top-right, head at the top.
function paintTool(type, mat) {
  const c = new Canvas();
  const HANDLE = 0;
  const HEAD = 1;
  if (type === "sword") {
    c.line(HEAD, 12, 20, 27.5, 4.5, 4.2, across(12, 20, 27.5, 4.5, 0.45));
    c.line(HANDLE, 9, 16, 16, 23, 2.8); // cross-guard
    c.line(HANDLE, 5, 27, 11, 21, 2.5);
    c.disc(HANDLE, 4.5, 27.5, 1.8);
  } else if (type === "pickaxe") {
    c.line(HANDLE, 5, 28, 19, 14, 2.7);
    // A crescent across the tip of the handle, perpendicular to it and bulging
    // away from it (circle centered further down the handle's axis).
    const cx = 11;
    const cy = 21;
    const mid = -Math.PI / 4;
    const span = 0.8;
    c.fill(HEAD, (x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      const a = Math.atan2(y - cy, x - cx) - mid;
      if (Math.abs(a) > span) return false;
      const taper = 1 - (a / span) ** 2 * 0.65; // thinner toward the points
      return d > 15.2 - 2.1 * taper && d < 15.2 + 1.9 * taper;
    }, (x, y) => (x + y < 30 ? 0.35 : -0.15));
  } else if (type === "axe") {
    c.line(HANDLE, 5, 28, 22, 11, 2.7);
    // A blade on one side of the handle with a curved cutting edge.
    c.poly(HEAD, [[14, 17], [21, 10], [18, 4], [13, 2.5], [8.5, 5], [7, 10], [9, 14]], (x, y) => (x + y < 18 ? 0.4 : -0.1));
  } else {
    // Shovel.
    c.line(HANDLE, 5, 28, 19, 14, 2.7);
    c.poly(HEAD, [[17, 11], [21, 6], [26, 5], [27, 10], [24, 15], [19, 16]], (x, y) => (x + y < 26 ? 0.35 : -0.2));
  }
  return c.render([RAMPS.wood, RAMPS[mat]]);
}

function paintIngot(ramp) {
  const c = new Canvas();
  c.poly(0, [[5, 17], [17, 11], [28, 15], [16, 21]], () => 0.6); // top
  c.poly(0, [[5, 17], [16, 21], [16, 26], [5, 22]], () => -0.35); // front
  c.poly(0, [[16, 21], [28, 15], [28, 20], [16, 26]], () => -0.05); // side
  return c.render([ramp]);
}

// Weapons, drawn pointing to the upper right like the tools.
function paintGrenade() {
  const c = new Canvas();
  const BODY = 0;
  const METAL = 1;
  c.disc(BODY, 15, 19, 8.5, 9.5, (x, y) => (x + y < 30 ? 0.4 : -0.2));
  // Segment grooves.
  for (const gy of [15, 19, 23]) c.line(BODY, 8, gy, 22, gy, 0.8, () => -1.2);
  for (const gx of [12, 18]) c.line(BODY, gx, 11, gx, 27, 0.8, () => -1.2);
  // Fuse head, lever and ring pin.
  c.poly(METAL, [[12, 8], [18, 8], [19, 11], [11, 11]], () => 0.5);
  c.line(METAL, 18, 9, 24, 17, 2, () => 0.2);
  c.disc(METAL, 9, 7, 3.2, 3.2, () => 0.6);
  c.disc(BODY, 9, 7, 1.6, 1.6, () => -2); // hole of the ring
  return c.render([RAMPS.olive, RAMPS.iron]);
}

function paintPistol() {
  const c = new Canvas();
  const METAL = 0;
  const GRIP = 1;
  c.poly(METAL, [[4, 10], [28, 10], [28, 16], [4, 16]], (x, y) => (y < 12 ? 0.5 : -0.1)); // slide + barrel
  c.poly(METAL, [[24, 16], [28, 16], [28, 17.5], [24, 17.5]], () => -0.3); // barrel under the slide
  c.poly(GRIP, [[5, 16], [12, 16], [11, 28], [4, 28], [3, 25]], (x, y) => (x < 7 ? 0.4 : -0.1)); // grip
  c.line(METAL, 12, 17, 16, 21, 1.2, () => -0.2); // trigger guard
  c.line(METAL, 16, 21, 18, 17, 1.2, () => -0.2);
  c.line(METAL, 13.5, 17, 14, 19.5, 1, () => 0.4); // trigger
  for (const sx of [6, 8, 10]) c.line(METAL, sx, 10.5, sx, 15.5, 0.6, () => -1.5); // slide serrations
  c.disc(METAL, 26.5, 9.5, 1, 1, () => 0.8); // front sight
  return c.render([RAMPS.gunmetal, RAMPS.grip]);
}

function paintBazooka() {
  const c = new Canvas();
  const TUBE = 0;
  const METAL = 1;
  c.line(TUBE, 3, 25, 27, 7, 6.2, across(3, 25, 27, 7, 0.5)); // tube
  c.poly(METAL, [[24, 4], [30, 9], [27, 13], [21, 8]], () => 0.3); // muzzle ring
  c.poly(METAL, [[1, 22], [6, 27], [4, 31], [-1, 26]], () => -0.1); // rear flare
  c.poly(METAL, [[13, 13], [17, 10], [19, 12.5], [15, 15.5]], () => 0.6); // sight
  c.line(METAL, 12, 22, 14, 27, 2, () => -0.1); // grip
  c.line(METAL, 18, 17.5, 20, 22, 2, () => -0.1); // front grip
  return c.render([RAMPS.olive, RAMPS.gunmetal]);
}

function paintMachineGun() {
  const c = new Canvas();
  const METAL = 0;
  const GRIP = 1;
  c.poly(METAL, [[3, 13], [27, 8], [29, 12], [5, 17]], (x, y) => (y < 12 ? 0.5 : -0.1)); // barrel + receiver
  c.line(METAL, 26, 8, 30, 4, 1.6, () => 0.4); // barrel tip
  c.poly(GRIP, [[7, 16], [13, 15], [12, 27], [5, 28], [4, 24]], (x, y) => (x < 8 ? 0.4 : -0.1)); // pistol grip
  c.poly(METAL, [[9, 17], [17, 16], [16, 22], [9, 23]], () => -0.25); // magazine
  c.line(GRIP, 24, 10, 30, 20, 2.6, () => -0.15); // folding stock
  for (const sx of [17, 20, 23]) c.line(METAL, sx, 8.5, sx, 12.5, 0.6, () => -1.5); // vents
  c.disc(METAL, 5.5, 14.5, 1, 1, () => 0.8); // sight
  return c.render([RAMPS.gunmetal, RAMPS.grip]);
}

function paintSniper() {
  const c = new Canvas();
  const METAL = 0;
  const GRIP = 1;
  const GLASS = 2;
  c.line(METAL, 2, 27, 29, 5, 2.6, across(2, 27, 29, 5, 0.4)); // long barrel
  c.poly(METAL, [[12, 17], [22, 10], [24, 13], [14, 20]], () => -0.1); // receiver block
  c.line(GLASS, 13, 12, 22, 6, 3, () => 0.5); // scope tube
  c.disc(GLASS, 22.5, 5.5, 1.6, 1.6, () => 0.9); // scope lens
  c.disc(GLASS, 12.5, 12.5, 1.4, 1.4, () => 0.9);
  c.poly(GRIP, [[10, 19], [15, 17], [13, 27], [7, 29], [6, 24]], (x, y) => (x < 10 ? 0.4 : -0.1)); // grip
  c.line(GRIP, 4, 22, 12, 18, 2.4, () => -0.2); // stock
  return c.render([RAMPS.gunmetal, RAMPS.grip, RAMPS.diamond]);
}

function paintAirstrike() {
  const c = new Canvas();
  const BODY = 0;
  const LENS = 1;
  const METAL = 2;
  c.poly(BODY, [[6, 10], [22, 8], [24, 24], [8, 26]], (x, y) => (x + y < 30 ? 0.35 : -0.15)); // handheld body
  c.disc(LENS, 15, 15, 4.2, 4.2, () => 0.5); // targeting lens
  c.disc(LENS, 15, 15, 2.2, 2.2, () => 1.2); // bright center
  c.line(METAL, 21, 9, 27, 3, 1.4, () => 0.5); // antenna
  c.disc(METAL, 27.5, 2.5, 1, 1, () => 0.8);
  c.line(METAL, 9, 24, 12, 24, 1.4, () => -0.2); // grip button
  return c.render([RAMPS.olive, RAMPS.red, RAMPS.gunmetal]);
}

function paintBlaster() {
  const c = new Canvas();
  const BODY = 0;
  const DARK = 1;
  const COIL = 2;
  c.poly(BODY, [[5, 10], [22, 9], [23, 16], [6, 17]], (x, y) => (y < 12 ? 0.6 : 0.1)); // body
  c.poly(DARK, [[22, 11], [29, 11], [29, 14.5], [22, 14.5]], () => 0.1); // barrel
  c.poly(DARK, [[7, 17], [13, 16.5], [12, 27], [6, 28], [5, 24]], (x) => (x < 8 ? 0.4 : -0.1)); // grip
  c.line(DARK, 6, 8.5, 20, 8, 1.2, () => 0.2); // top rail
  for (const x of [23.5, 25.5, 27.5]) c.line(COIL, x, 10, x, 15.5, 0.9, () => 0.8); // glowing coils
  c.disc(COIL, 30, 12.7, 1.2, 1.4, () => 1.1); // emitter
  return c.render([RAMPS.cloth, RAMPS.gunmetal, RAMPS.diamond]);
}

function paintJetRadio() {
  const c = new Canvas();
  const BODY = 0;
  const SCREEN = 1;
  const METAL = 2;
  c.poly(BODY, [[8, 9], [21, 8], [22, 28], [9, 29]], (x, y) => (x < 12 ? 0.35 : -0.1)); // handset
  c.poly(SCREEN, [[10.5, 11], [19.5, 10.5], [19.5, 17], [10.5, 17.5]], () => 0.4); // screen
  c.line(SCREEN, 12, 14.5, 18, 13, 0.8, () => 1.2); // a jet blip on the screen
  for (const [x, y] of [[12, 21], [15.5, 21], [19, 21], [12, 24.5], [15.5, 24.5], [19, 24.5]]) c.disc(METAL, x, y, 1.1, 1.1, () => 0.5); // keys
  c.line(METAL, 18, 8, 22, 1.5, 1.3, () => 0.5); // antenna
  c.disc(1, 22.5, 1.5, 1.2, 1.2, () => 1.2);
  return c.render([RAMPS.olive, RAMPS.leaf, RAMPS.iron]);
}

function paintRailgun() {
  const c = new Canvas();
  const BODY = 0;
  const RAIL = 1;
  const COIL = 2;
  const GRIP = 3;
  c.poly(BODY, [[4, 12], [16, 11], [17, 17], [4, 18]], (x, y) => (y < 14 ? 0.5 : -0.05)); // receiver
  c.poly(RAIL, [[16, 11.5], [30, 12], [30, 13.2], [16, 13]], () => 0.55); // upper rail
  c.poly(RAIL, [[17, 15.2], [30, 15], [30, 16.3], [17, 17]], () => 0.1); // lower rail
  for (const x of [19, 22, 25, 28]) c.line(COIL, x, 10.5, x, 18, 1.1, () => 0.9); // glowing coil rings
  c.poly(GRIP, [[7, 18], [12, 17.5], [11, 27], [6.5, 27.5]], (x) => (x < 9 ? 0.3 : -0.1)); // grip
  c.poly(BODY, [[1, 13], [5, 12.5], [5, 18], [1, 19]], () => -0.1); // stock
  c.disc(COIL, 30.5, 14, 1.2, 1.4, () => 1.2); // muzzle glow
  return c.render([RAMPS.gunmetal, RAMPS.iron, RAMPS.plasma, RAMPS.grip]);
}

function paintMinigun() {
  const c = new Canvas();
  const BODY = 0;
  const BARREL = 1;
  const GLOW = 2;
  const GRIP = 3;
  for (const y of [8.5, 11.2, 13.9, 16.6]) c.line(BARREL, 15, y, 30, y, 1.9, () => (y < 12 ? 0.4 : -0.05)); // the barrel cluster
  c.disc(BODY, 13, 12.8, 5.2, 6.2, (x, y) => (y < 11 ? 0.55 : 0.0)); // drum housing
  c.line(BARREL, 22, 7, 22, 19, 1.1, () => 0.3); // a clamp ring
  c.line(BARREL, 27, 7, 27, 19, 1.1, () => 0.3);
  c.poly(BODY, [[3, 17], [10, 18], [10, 25], [3, 25]], () => -0.1); // ammo box
  c.poly(GRIP, [[10, 19], [15, 19.5], [14, 28], [9.5, 27.5]], (x) => (x < 12 ? 0.3 : -0.1)); // grip
  c.line(BARREL, 8, 8, 16, 8, 1.4, () => 0.5); // carry handle
  c.disc(GLOW, 30.4, 12.6, 1.2, 4.6, () => 1.0); // muzzle glow
  c.disc(GLOW, 13, 12.8, 1.8, 1.8, () => 1.0); // the motor light
  return c.render([RAMPS.gunmetal, RAMPS.iron, RAMPS.plasma, RAMPS.grip]);
}

// The bow: a curved wooden limb from top right to bottom left, with a
// taut string.
function paintBow() {
  const c = new Canvas();
  const WOOD = 0;
  const STRING = 1;
  // The limb: points along an arc.
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = -Math.PI * 0.25 + t * Math.PI * 1.0 - Math.PI * 0.5;
    pts.push([13 + Math.cos(a) * 15, 17 + Math.sin(a) * 15]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const w = 2.6 - Math.abs(i - 8) * 0.12;
    c.line(WOOD, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, () => (i < 8 ? 0.3 : -0.1));
  }
  const [a, b] = [pts[0], pts[pts.length - 1]];
  c.line(STRING, a[0], a[1], b[0], b[1], 0.9, () => 0.6);
  c.line(WOOD, pts[7][0], pts[7][1], pts[9][0], pts[9][1], 3.4, () => -0.45); // the grip wrap, mid-limb
  return c.render([RAMPS.wood, RAMPS.cloth]);
}

const PAINTERS = {
  bow: paintBow,
  railgun: paintRailgun,
  minigun: paintMinigun,
  blaster: paintBlaster,
  jet_radio: paintJetRadio,
  grenade: paintGrenade,
  pistol: paintPistol,
  bazooka: paintBazooka,
  machinegun: paintMachineGun,
  sniper: paintSniper,
  airstrike: paintAirstrike,
  stick: () => {
    const c = new Canvas();
    c.line(0, 7, 26, 25, 8, 2.6);
    return c.render([RAMPS.wood]);
  },
  coal: () => {
    const c = new Canvas();
    c.disc(0, 14, 17, 8, 7, (x, y) => (x + y < 28 ? 0.4 : -0.2));
    c.disc(0, 20, 14, 6, 6, (x, y) => (x + y < 30 ? 0.5 : 0));
    c.disc(0, 18, 21, 6, 5);
    return c.render([RAMPS.coal], [6, 6, 8]);
  },
  iron_ingot: () => paintIngot(RAMPS.iron),
  gold_ingot: () => paintIngot(RAMPS.gold),
  diamond: () => {
    const c = new Canvas();
    c.poly(0, [[16, 5], [26, 12], [16, 28], [6, 12]], (x, y) => (y < 12 ? 0.6 : x < 16 ? 0.1 : -0.4));
    return c.render([RAMPS.diamond], [8, 40, 48]);
  },
  apple: () => paintApple(RAMPS.red),
  golden_apple: () => paintApple(RAMPS.gold),
  raw_meat: () => paintMeat(RAMPS.meat, false),
  cooked_meat: () => paintMeat(RAMPS.cooked, true),
  fluff: () => {
    const c = new Canvas();
    for (const [x, y, r] of [[12, 17, 6], [19, 14, 7], [21, 20, 6], [14, 22, 5], [16, 11, 5]]) {
      c.disc(0, x, y, r, r, (px, py) => (px + py < x + y - 2 ? 0.5 : -0.1));
    }
    return c.render([RAMPS.cloth], [110, 104, 92]);
  },
};

function paintApple(ramp) {
  const c = new Canvas();
  c.disc(1, 16, 18, 9.5, 9, (x, y) => (x + y < 30 ? 0.35 : -0.2));
  c.line(0, 16, 10, 17, 4, 1.8); // stem
  c.disc(2, 21, 6, 3.5, 2); // leaf
  c.disc(1, 12, 14, 1.6, 1.6, () => 1); // highlight
  return c.render([RAMPS.wood, ramp, RAMPS.leaf]);
}

function paintMeat(ramp, cooked) {
  const c = new Canvas();
  c.disc(0, 15, 17, 11, 7.5, (x, y) => (y < 15 ? 0.35 : -0.15));
  c.disc(1, 26, 21, 2.6, 2.4); // bone end
  c.line(1, 23, 19, 27, 22, 2.2);
  // Marbling (raw) or grill marks (cooked).
  if (cooked) {
    for (const x of [10, 15, 20]) c.line(0, x, 12, x - 4, 22, 1.2, () => -2);
  } else {
    c.line(1, 8, 16, 20, 13, 1.3);
    c.line(1, 10, 21, 18, 19, 1.1);
  }
  return c.render([ramp, RAMPS.cloth]);
}

// Armor: helmet, chestplate, leggings and boots in a material's color ramp
// (leather, gold, iron, diamond): the classic armor-icon shapes.
function paintArmor(piece, ramp, outline) {
  const c = new Canvas();
  const light = (x, y) => (x + y < 30 ? 0.35 : -0.2);
  if (piece === "helmet") {
    const dome = (x, y) => ((x - 16) / 11) ** 2 + ((y - 15) / 10) ** 2 <= 1 && y <= 25;
    c.fill(0, (x, y) => dome(x, y) && !(x > 10.5 && x < 21.5 && y > 17.5), light);
    c.fill(0, (x, y) => y >= 15 && y <= 25 && (x < 11 && x > 5 || x > 21 && x < 27) && ((x - 16) / 11.5) ** 2 + ((y - 15) / 10.5) ** 2 <= 1.15, light);
    c.line(0, 8, 13, 24, 13, 1.4, () => -0.8); // a band across the dome
    c.line(0, 16, 6, 16, 12, 1.2, () => 0.5); // a crest ridge
  } else if (piece === "chestplate") {
    const body = (x, y) => {
      if (y >= 5 && y <= 14 && (x >= 3 && x <= 11 || x >= 21 && x <= 29)) return true; // the shoulders
      if (y >= 5 && y <= 27 && x >= 9 && x <= 23) return !(y < 9 && x > 12.5 && x < 19.5); // the torso, with a neck hole
      return false;
    };
    c.fill(0, body, light);
    c.line(0, 16, 12, 16, 27, 1.0, () => -0.6); // the centre seam
    c.line(0, 10, 18, 22, 18, 1.0, () => -0.4); // a belt line
  } else if (piece === "leggings") {
    c.poly(0, [[7, 5], [25, 5], [25, 11], [7, 11]], light);
    c.poly(0, [[7, 11], [15.5, 11], [14.5, 28], [6, 28]], light);
    c.poly(0, [[16.5, 11], [25, 11], [26, 28], [17.5, 28]], light);
    c.line(0, 8, 8, 24, 8, 1.0, () => -0.7); // the belt
  } else {
    for (const ox of [0, 15]) {
      c.poly(0, [[4 + ox, 5], [13 + ox, 5], [13 + ox, 19], [16 + ox, 21], [16 + ox, 27], [3 + ox, 27]], light);
      c.line(0, 4 + ox, 22, 15 + ox, 22, 1.2, () => -0.7); // the sole line
    }
  }
  return c.render([ramp], outline);
}
const ARMOR_RAMPS = { leather: [RAMPS.leather, [24, 12, 6]], gold: [RAMPS.gold, [40, 24, 4]], iron: [RAMPS.iron, [26, 28, 32]], diamond: [RAMPS.diamond, [6, 40, 46]] };
for (const [tier, [ramp, outline]] of Object.entries(ARMOR_RAMPS)) {
  for (const piece of ["helmet", "chestplate", "leggings", "boots"]) PAINTERS[`armor_${tier}_${piece}`] = () => paintArmor(piece, ramp, outline);
}

// The bow being drawn (stage 1-3): the limbs bend toward the archer and the
// string is pulled back with an arrow nocked, pointing out of the front.
const BOW_PULL_CACHE = new Map();
export function bowPullPixels(stage) {
  if (BOW_PULL_CACHE.has(stage)) return BOW_PULL_CACHE.get(stage);
  const c = new Canvas();
  const WOOD = 0;
  const STRING = 1;
  const SHAFT = 2;
  const TIP = 3;
  const FEATHER = 4;
  const k = stage / 3;
  const dir = [-Math.SQRT1_2, Math.SQRT1_2]; // toward the archer
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = -Math.PI * 0.25 + t * Math.PI * 1.0 - Math.PI * 0.5;
    const bend = k * 2.6 * Math.pow(Math.abs(t - 0.5) * 2, 2); // the tips bend toward the archer
    pts.push([13 + Math.cos(a) * 15 + dir[0] * bend, 17 + Math.sin(a) * 15 + dir[1] * bend]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const w = 2.6 - Math.abs(i - 8) * 0.12;
    c.line(WOOD, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, () => (i < 8 ? 0.3 : -0.1));
  }
  c.line(WOOD, pts[7][0], pts[7][1], pts[9][0], pts[9][1], 3.4, () => -0.45); // the grip wrap
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const pull = [mid[0] + dir[0] * (1.5 + k * 5.5), mid[1] + dir[1] * (1.5 + k * 5.5)];
  c.line(STRING, a[0], a[1], pull[0], pull[1], 0.9, () => 0.6);
  c.line(STRING, b[0], b[1], pull[0], pull[1], 0.9, () => 0.6);
  // The arrow: from the string out through the bow.
  const fwd = [-dir[0], -dir[1]];
  const tail = [pull[0] + dir[0] * 1.5, pull[1] + dir[1] * 1.5];
  const head = [pull[0] + fwd[0] * 22, pull[1] + fwd[1] * 22];
  c.line(SHAFT, tail[0], tail[1], head[0], head[1], 1.3, () => 0.2);
  c.poly(TIP, [[head[0] + fwd[0] * 3.2, head[1] + fwd[1] * 3.2], [head[0] - fwd[1] * 1.7, head[1] + fwd[0] * 1.7], [head[0] + fwd[1] * 1.7, head[1] - fwd[0] * 1.7]], () => 0.3);
  c.line(FEATHER, tail[0] - fwd[0] * 0.5, tail[1] - fwd[1] * 0.5, tail[0] + fwd[0] * 3.6, tail[1] + fwd[1] * 3.6, 2.6, () => 0.4);
  const px = c.render([RAMPS.wood, RAMPS.cloth, RAMPS.wood, RAMPS.iron, RAMPS.cloth]);
  BOW_PULL_CACHE.set(stage, px);
  return px;
}

export function paintItemIcon(iconName) {
  if (PAINTERS[iconName]) return PAINTERS[iconName]();
  const m = /^(sword|pickaxe|axe|shovel)_(wood|stone|iron|diamond)$/.exec(iconName);
  if (m) return paintTool(m[1], m[2]);
  throw new Error(`No item icon painter for "${iconName}"`);
}

function toCanvas(pixels) {
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels), N, N), 0, 0);
  return canvas;
}

// Icon pixels + canvas for an item (non-block) id, cached.
const iconCache = new Map();
export function itemIconPixels(id) {
  const info = itemInfo(id);
  if (!info || !info.icon) return null;
  if (!iconCache.has(info.icon)) iconCache.set(info.icon, paintItemIcon(info.icon));
  return iconCache.get(info.icon);
}

const canvasCache = new Map();
export function itemIconCanvas(id) {
  const info = itemInfo(id);
  if (!info || !info.icon) return null;
  if (!canvasCache.has(info.icon)) canvasCache.set(info.icon, toCanvas(itemIconPixels(id)));
  return canvasCache.get(info.icon);
}

// Ten crack overlay stages for blocks being mined (transparent + dark cracks).
export function buildCrackStages() {
  let seed = 1234567;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  // Many short, branching cracks scattered over the face; each segment gets
  // a "birth time" so later stages show more and longer cracks.
  const segments = [];
  const grow = (x, y, ang, len, t0, depth) => {
    for (let i = 0; i < len; i++) {
      const nx = x + Math.cos(ang) * 1.4;
      const ny = y + Math.sin(ang) * 1.4;
      segments.push([x, y, nx, ny, t0 + i * 0.045]);
      x = nx;
      y = ny;
      ang += (rand() - 0.5) * 1.1;
      if (depth < 2 && rand() < 0.2) grow(x, y, ang + (rand() < 0.5 ? 1 : -1) * (0.7 + rand() * 0.7), Math.floor(len * 0.5), t0 + i * 0.045, depth + 1);
    }
  };
  for (let k = 0; k < 14; k++) {
    const start = k === 0 ? 0 : rand() * 0.55;
    const x = 4 + rand() * 24;
    const y = 4 + rand() * 24;
    const ang = rand() * Math.PI * 2;
    grow(x, y, ang, 5 + Math.floor(rand() * 7), start, 0);
    grow(x, y, ang + Math.PI, 3 + Math.floor(rand() * 5), start, 1);
  }
  const stages = [];
  for (let s = 1; s <= 10; s++) {
    const c = new Canvas();
    for (const [x0, y0, x1, y1, born] of segments) {
      if (born <= s / 10) c.line(0, x0, y0, x1, y1, 1.15);
    }
    const data = new Uint8ClampedArray(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      if (!c.mask[i]) continue;
      data[i * 4] = 20;
      data[i * 4 + 1] = 16;
      data[i * 4 + 2] = 14;
      data[i * 4 + 3] = 200;
    }
    stages.push(toCanvas(data));
  }
  return stages;
}
