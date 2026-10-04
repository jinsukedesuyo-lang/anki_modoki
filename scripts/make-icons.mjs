// icon.svg と同じ図柄の PNG を依存なしで生成する（node scripts/make-icons.mjs）
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// 512 基準の角丸四角形リスト（icon.svg と同じ）
const SHAPES = [
  { x: 0, y: 0, w: 512, h: 512, r: 112, c: [0x1f, 0x6f, 0xeb] },
  { x: 96, y: 136, w: 320, h: 240, r: 28, c: [0xff, 0xff, 0xff] },
  { x: 136, y: 196, w: 112, h: 28, r: 10, c: [0xc9, 0xd1, 0xd9] },
  { x: 264, y: 196, w: 112, h: 28, r: 10, c: [0xf7, 0x67, 0x07] },
  { x: 136, y: 252, w: 240, h: 28, r: 10, c: [0xc9, 0xd1, 0xd9] },
  { x: 136, y: 308, w: 160, h: 28, r: 10, c: [0xc9, 0xd1, 0xd9] },
];

function inside(s, x, y) {
  if (x < s.x || y < s.y || x > s.x + s.w || y > s.y + s.h) return false;
  const cx = Math.min(Math.max(x, s.x + s.r), s.x + s.w - s.r);
  const cy = Math.min(Math.max(y, s.y + s.r), s.y + s.h - s.r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= s.r ** 2;
}

function render(size, fullBleed) {
  const SS = 4; // スーパーサンプリング
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 512;
          const v = ((y + (sy + 0.5) / SS) / size) * 512;
          let col = null;
          for (const [i, s] of SHAPES.entries()) {
            const shape = i === 0 && fullBleed ? { ...s, r: 0 } : s;
            if (inside(shape, u, v)) col = s.c;
          }
          if (col) {
            r += col[0]; g += col[1]; b += col[2]; a += 255;
          }
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const cov = a / 255;
      px[o] = cov ? Math.round(r / cov) : 0;
      px[o + 1] = cov ? Math.round(g / cov) : 0;
      px[o + 2] = cov ? Math.round(b / cov) : 0;
      px[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
mkdirSync('extension/icons', { recursive: true });
// iOS は角丸を自前で付けるので PWA 用は角なし
writeFileSync('public/icons/icon-192.png', render(192, true));
writeFileSync('public/icons/icon-512.png', render(512, true));
for (const s of [16, 48, 128]) writeFileSync(`extension/icons/icon-${s}.png`, render(s, false));
console.log('icons generated');
