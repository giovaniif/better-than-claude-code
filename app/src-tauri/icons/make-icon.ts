// Draws the app icon source (1024x1024 PNG): a dark rounded square with a
// track switch, one line splitting into two. `tauri icon` makes the rest.
// Usage: bun make-icon.ts <out.png>
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 1024;
const SS = 3; // supersampling per axis

const INSET = 96;
const RADIUS = 200;
const STROKE = 38;

type P = [number, number];
const SEGMENTS: [P, P][] = [
  [[512, 770], [512, 540]],
  [[512, 540], [352, 300]],
  [[512, 540], [672, 300]],
];

function inRoundedSquare(x: number, y: number): boolean {
  const lo = INSET;
  const hi = SIZE - INSET;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + RADIUS), hi - RADIUS);
  const cy = Math.min(Math.max(y, lo + RADIUS), hi - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

function distToSegment(x: number, y: number, [a, b]: [P, P]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

const onGlyph = (x: number, y: number) => SEGMENTS.some((s) => distToSegment(x, y, s) <= STROKE);

// RGBA rows, each prefixed with a filter byte (0 = none).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  for (let x = 0; x < SIZE; x++) {
    let cover = 0;
    let light = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        if (!inRoundedSquare(px, py)) continue;
        cover++;
        if (onGlyph(px, py)) light++;
      }
    }
    const total = SS * SS;
    const shade = cover ? Math.round(26 + (255 - 26) * (light / cover)) : 0;
    const i = row + 1 + x * 4;
    raw[i] = shade;
    raw[i + 1] = shade;
    raw[i + 2] = shade;
    raw[i + 3] = Math.round((cover / total) * 255);
  }
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? "source.png", png);
