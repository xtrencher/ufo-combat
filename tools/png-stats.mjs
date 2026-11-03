// A tiny PNG reader for the tests (Round 16): decodes an 8-bit RGB / RGBA
// screenshot (Playwright's) and sums up its pixels, so a test can tell a
// black screen from a picture without any package.
//   pngStats(buffer) -> { w, h, mean (0-255), lit (share of pixels brighter
//   than 24), colours (distinct coarse colours) }
import zlib from "node:zlib";

export function decodePng(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      type = data[9];
    } else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * bpp);
  const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

export function pngStats(buf) {
  const { w, h, bpp, data } = decodePng(buf);
  let sum = 0;
  let lit = 0;
  const cols = new Set();
  const n = w * h;
  for (let i = 0; i < n; i += 7) {
    const r = data[i * bpp];
    const g = data[i * bpp + 1];
    const b = data[i * bpp + 2];
    const l = (r + g + b) / 3;
    sum += l;
    if (l > 24) lit++;
    cols.add(((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5));
  }
  const samples = Math.ceil(n / 7);
  return { w, h, mean: sum / samples, lit: lit / samples, colours: cols.size };
}
