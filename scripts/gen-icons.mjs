// Generates the PWA PNG icons with zero dependencies (zlib + a tiny PNG
// encoder). Draws a "target / parking marker" matching the ⌖ brand mark.
// Run with: node scripts/gen-icons.mjs
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(OUT, { recursive: true });

// CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// colours
const BG = [17, 32, 29];
const ACCENT = [15, 138, 106];
const AMBER = [217, 138, 31];

const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (base, c, a) => [
  Math.round(base[0] * (1 - a) + c[0] * a),
  Math.round(base[1] * (1 - a) + c[1] * a),
  Math.round(base[2] * (1 - a) + c[2] * a),
];

function makeIcon(size, { fraction }) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const R1 = size * fraction; // outer ring
  const R2 = R1 * 0.55; // inner ring
  const R3 = R1 * 0.16; // centre dot
  const ringT = size * 0.045; // ring thickness
  const lineW = size * 0.028; // crosshair half-width
  const aa = 1.2; // anti-alias softness in px

  const ringCov = (r, R) => clamp(ringT / 2 + aa / 2 - Math.abs(r - R)) / aa * aa;
  const cov = (d) => clamp((d + aa / 2) / aa); // d = signed distance inside shape

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);

      // accent coverage: two rings + crosshair plus
      const ring1 = cov(ringT / 2 - Math.abs(r - R1));
      const ring2 = cov(ringT / 2 - Math.abs(r - R2));
      const horiz = cov(lineW - Math.abs(dy)) * cov(R1 - Math.abs(dx));
      const vert = cov(lineW - Math.abs(dx)) * cov(R1 - Math.abs(dy));
      const accentA = Math.max(ring1, ring2, horiz, vert);

      // centre dot (amber) sits on top
      const dotA = cov(R3 - r);

      let col = BG;
      if (accentA > 0) col = mix(col, ACCENT, accentA);
      if (dotA > 0) col = mix(col, AMBER, dotA);

      const i = (y * size + x) * 4;
      buf[i] = col[0];
      buf[i + 1] = col[1];
      buf[i + 2] = col[2];
      buf[i + 3] = 255;
    }
  }
  return encodePng(size, size, buf);
}

const targets = [
  { file: "icon-192.png", size: 192, fraction: 0.4 },
  { file: "icon-512.png", size: 512, fraction: 0.4 },
  { file: "icon-maskable-512.png", size: 512, fraction: 0.32 },
  { file: "apple-touch-icon.png", size: 180, fraction: 0.4 },
];

for (const t of targets) {
  writeFileSync(join(OUT, t.file), makeIcon(t.size, { fraction: t.fraction }));
  console.log("wrote", t.file);
}
