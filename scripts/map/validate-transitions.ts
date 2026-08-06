// Validate that every generated transition sheet actually contains usable
// edge modules in the expected layout:
//   rows 0-3: terrain A body + B strip on N / S / W / E
//   rows 4-7: terrain B body + A strip on N / S / W / E
// A sheet only PASSES when all 8 tiles detect a strip on the expected side.
// Usage:
//   npx tsx scripts/map/validate-transitions.ts            # validate only
//   npx tsx scripts/map/validate-transitions.ts --fix      # normalize to 1024x1024
//                                                          # and mirror W->E for missing
//                                                          # right-edge modules
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { createBuffer, getPx, setPx, type PixelBuffer } from './pixel-art';

const GEN_DIR = path.join(__dirname, '../../assets/source/mvp2/original/generated-terrain');

const TRANSITION_FILES: Array<[string, string]> = [
  ['drySand', 'grass'],
  ['deep', 'shallow'],
  ['shallow', 'wetSand'],
  ['wetSand', 'drySand'],
  ['grass', 'sparse'],
  ['grass', 'dense'],
  ['grass', 'mud'],
  ['grass', 'rock'],
  ['rock', 'cliff'],
];

const EXPECTED: Array<'N' | 'S' | 'W' | 'E'> = ['N', 'S', 'W', 'E'];

function readPng(p: string): PixelBuffer {
  const png = PNG.sync.read(fs.readFileSync(p));
  return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data) };
}

function bandAvg(t: PixelBuffer, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [rr, gg, bb, a] = getPx(t, x, y);
      if (a > 0) {
        r += rr;
        g += gg;
        b += bb;
        n++;
      }
    }
  }
  return n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
}

// Detect which side carries a strip different from the tile center.
export function detectStripSide(t: PixelBuffer): 'N' | 'S' | 'W' | 'E' | null {
  const top = bandAvg(t, 0, 0, 32, 8);
  const bot = bandAvg(t, 0, 24, 32, 32);
  const left = bandAvg(t, 0, 0, 8, 32);
  const right = bandAvg(t, 24, 0, 32, 32);
  const center = bandAvg(t, 12, 12, 20, 20);
  const d = (a: [number, number, number]) => (a[0] - center[0]) ** 2 + (a[1] - center[1]) ** 2 + (a[2] - center[2]) ** 2;
  const scores: Array<['N' | 'S' | 'W' | 'E', number]> = [
    ['N', d(top)],
    ['S', d(bot)],
    ['W', d(left)],
    ['E', d(right)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 700 ? scores[0][0] : null;
}

function resizeSheet(src: PixelBuffer, size: number): PixelBuffer {
  const out = createBuffer(size, size, null);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = getPx(src, Math.floor((x / size) * src.w), Math.floor((y / size) * src.h));
      setPx(out, x, y, [r, g, b], a);
    }
  }
  return out;
}

// Extract tile row from a sheet whose cells are 128px (or resized to that).
export function extractTile(src: PixelBuffer, row: number): PixelBuffer {
  const targetCell = 128;
  const norm = src.w === 8 * targetCell && src.h === 8 * targetCell ? src : resizeSheet(src, 8 * targetCell);
  const t = createBuffer(32, 32, null);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const [r, g, b, a] = getPx(norm, x * 4, row * targetCell + y * 4);
      setPx(t, x, y, [r, g, b], a);
    }
  }
  return t;
}

export function validateTransitionSheet(file: string): { ok: boolean; rows: Array<{ row: number; expected: string; detected: string | null; pass: boolean }>; size: string } {
  const src = readPng(path.join(GEN_DIR, 'transitions', file));
  const rows: Array<{ row: number; expected: string; detected: string | null; pass: boolean }> = [];
  let ok = true;
  for (let row = 0; row < 8; row++) {
    const t = extractTile(src, row);
    const detected = detectStripSide(t);
    const expected = EXPECTED[row % 4];
    const pass = detected === expected;
    if (!pass) ok = false;
    rows.push({ row, expected, detected, pass });
  }
  return { ok, rows, size: `${src.w}x${src.h}` };
}

export function validateAllTransitions(): { pass: number; fail: Array<{ file: string; rows: Array<{ row: number; expected: string; detected: string | null; pass: boolean }>; size: string }>; total: number } {
  const fail: Array<{ file: string; rows: Array<{ row: number; expected: string; detected: string | null; pass: boolean }>; size: string }> = [];
  let pass = 0;
  for (const [a, b] of TRANSITION_FILES) {
    const file = `${a}-${b}.png`;
    const res = validateTransitionSheet(file);
    if (res.ok) {
      pass++;
      console.log(`PASS  ${file} (${res.size})`);
    } else {
      fail.push({ file, rows: res.rows, size: res.size });
      console.log(`FAIL  ${file} (${res.size})`);
      for (const r of res.rows) {
        console.log(`      row ${r.row} expect ${r.expected} got ${r.detected ?? 'NONE'} ${r.pass ? 'ok' : '!!'}`);
      }
    }
  }
  return { pass, fail, total: TRANSITION_FILES.length };
}

function mirrorH(t: PixelBuffer): PixelBuffer {
  const out = createBuffer(t.w, t.h, null);
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const [r, g, b, a] = getPx(t, t.w - 1 - x, y);
      setPx(out, x, y, [r, g, b], a);
    }
  }
  return out;
}

function bufferToPng(buf: PixelBuffer): Buffer {
  const png = new PNG({ width: buf.w, height: buf.h });
  for (let i = 0; i < buf.w * buf.h * 4; i++) png.data[i] = buf.data[i];
  return PNG.sync.write(png);
}

// Normalize a sheet to an exact 1024x1024 8x8 grid (128px cells) and replace
// any row whose strip is not on the expected side with a mirrored copy of its
// W-counterpart row (standard tileset flip so every edge module exists).
export function normalizeTransitionSheet(file: string): { ok: boolean; mirrored: string[] } {
  const p = path.join(GEN_DIR, 'transitions', file);
  const src = readPng(p);
  const norm = resizeSheet(src, 1024);
  const mirrored: string[] = [];
  for (let row = 0; row < 8; row++) {
    const t = extractTile(norm, row);
    const detected = detectStripSide(t);
    const expected = EXPECTED[row % 4];
    if (detected !== expected) {
      // Replace the whole row with the mirrored W-row tile.
      const srcRow = row >= 4 ? 6 : 2;
      const mirror = mirrorH(extractTile(norm, srcRow));
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const [r, g, b, a] = getPx(mirror, x, y);
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++) {
              const nx = x * 4 + dx;
              const ny = row * 128 + y * 4 + dy;
              const idx = (ny * norm.w + nx) * 4;
              norm.data[idx] = r;
              norm.data[idx + 1] = g;
              norm.data[idx + 2] = b;
              norm.data[idx + 3] = a;
            }
          }
        }
      }
      mirrored.push(`row ${row} (${expected}) <- mirror of row ${srcRow}`);
    }
  }
  fs.writeFileSync(p, bufferToPng(norm));
  const after = validateTransitionSheet(file);
  return { ok: after.ok, mirrored };
}

if (require.main === module) {
  if (process.argv[2] === '--fix') {
    let ok = true;
    for (const [a, b] of TRANSITION_FILES) {
      const file = `${a}-${b}.png`;
      const res = normalizeTransitionSheet(file);
      console.log(res.ok ? `PASS  ${file}` : `FAIL  ${file}`);
      for (const m of res.mirrored) console.log(`      ${m}`);
      if (!res.ok) ok = false;
    }
    console.log(ok ? '\nall sheets normalized and valid' : '\nfix incomplete');
    process.exit(ok ? 0 : 1);
  } else {
    const res = validateAllTransitions();
    console.log(`\n${res.pass}/${res.total} sheets passed`);
    process.exit(res.fail.length === 0 ? 0 : 1);
  }
}
