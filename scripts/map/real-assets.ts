// Terrain base tile pipeline for the MVP2 map.
// Sources: AI-generated PIXEL-ART tileset sheets (assets/source/mvp2/
// original/generated-terrain/*.png): each sheet is an 8x8 grid where every
// cell is a 32x32 pixel-art tile drawn at 4x scale (128px cells). Build-time
// extracts cells with 4x NEAREST downscale (no re-styling), picks variants
// and normalizes the 1px border so same-class tiles stay seam-free.

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { atlasFromTiles, bufferToPng, createBuffer, getPx, setPx, type PixelBuffer } from './pixel-art';

const SRC = path.join(__dirname, '../../assets/source/mvp2/original');
const GEN_DIR = path.join(SRC, 'generated-terrain');

function readPng(p: string): PixelBuffer {
  const png = PNG.sync.read(fs.readFileSync(p));
  return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data) };
}

function tile16(buf: PixelBuffer, ts: number, c: number, r: number): PixelBuffer {
  const out = createBuffer(ts, ts, null);
  for (let y = 0; y < ts; y++) {
    for (let x = 0; x < ts; x++) {
      const [rr, g, b, a] = getPx(buf, c * ts + x, r * ts + y);
      setPx(out, x, y, [rr, g, b], a);
    }
  }
  return out;
}

function upscale2(buf: PixelBuffer): PixelBuffer {
  const out = createBuffer(buf.w * 2, buf.h * 2, null);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const [r, g, b, a] = getPx(buf, Math.floor(x / 2), Math.floor(y / 2));
      setPx(out, x, y, [r, g, b], a);
    }
  }
  return out;
}

function nearestResize(src: PixelBuffer, tw: number, th: number): PixelBuffer {
  const out = createBuffer(tw, th, null);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const [r, g, b, a] = getPx(src, Math.floor((x / tw) * src.w), Math.floor((y / th) * src.h));
      setPx(out, x, y, [r, g, b], a);
    }
  }
  return out;
}

export type BasePick = {
  file: string;
  tile: { c: number; r: number };
  ts: number; // source tile size
  scale: number; // upscale factor to reach 32px
};

// Class -> hue predicate used to build candidate pools from Zoria.
// Chosen so multiple textured variants per class can be auto-selected with
// matching border colors (seam-safe variants).
function hueClass(avg: [number, number, number]): string | null {
  const [r, g, b] = avg;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn < 24) return mx > 110 ? 'gray' : null;
  if (b >= r && b >= g && b > 90) return 'water';
  if (g >= r && g >= b && g - b > 15) return 'green';
  if (r >= g && g >= b && r > 90 && r - b > 40) return 'warm';
  return null;
}

export function buildCandidatePool(file: string, ts: number, pred: (avg: [number, number, number], varScore: number) => boolean, maxVar = 6500): Array<{ c: number; r: number; avg: [number, number, number]; varScore: number; border: [number, number, number] }> {
  const src = readPng(path.join(SRC, file));
  const out: Array<{ c: number; r: number; avg: [number, number, number]; varScore: number; border: [number, number, number] }> = [];
  const cols = Math.floor(src.w / ts);
  const rows = Math.floor(src.h / ts);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = tile16(src, ts, c, r);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const [rr, g, b, a] = getPx(t, x, y);
          if (a > 0) {
            sr += rr;
            sg += g;
            sb += b;
            n++;
          }
        }
      }
      if (n < ts * ts * 0.85) continue;
      const avg: [number, number, number] = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
      let varScore = 0;
      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const [rr, g, b] = getPx(t, x, y);
          varScore += (rr - avg[0]) ** 2 + (g - avg[1]) ** 2 + (b - avg[2]) ** 2;
        }
      }
      varScore = Math.round(varScore / n);
      if (varScore > maxVar) continue;
      if (!pred(avg, varScore)) continue;
      // Border color (average of 1px border).
      let br = 0;
      let bg = 0;
      let bb = 0;
      let bn = 0;
      for (let x = 0; x < ts; x++) {
        for (const [px, py] of [[x, 0], [x, ts - 1]] as Array<[number, number]>) {
          const [rr, g, b, a] = getPx(t, px, py);
          if (a > 0) {
            br += rr;
            bg += g;
            bb += b;
            bn++;
          }
        }
      }
      for (let y = 0; y < ts; y++) {
        for (const [px, py] of [[0, y], [ts - 1, y]] as Array<[number, number]>) {
          const [rr, g, b, a] = getPx(t, px, py);
          if (a > 0) {
            br += rr;
            bg += g;
            bb += b;
            bn++;
          }
        }
      }
      const border: [number, number, number] = bn > 0 ? [Math.round(br / bn), Math.round(bg / bn), Math.round(bb / bn)] : avg;
      out.push({ c, r, avg, varScore, border });
    }
  }
  return out;
}

function pickVariants(pool: Array<{ c: number; r: number; avg: [number, number, number]; varScore: number; border: [number, number, number] }>, count: number, minVar: number): Array<{ c: number; r: number }> {
  // Cluster by border color; prefer textured (varScore >= minVar) tiles.
  const textured = pool.filter((p) => p.varScore >= minVar);
  const groups = new Map<string, typeof textured>();
  for (const p of textured) {
    const key = `${Math.round(p.border[0] / 16)},${Math.round(p.border[1] / 16)},${Math.round(p.border[2] / 16)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? textured;
  const picked = [...best].sort((a, b) => a.varScore - b.varScore).slice(0, count);
  return picked.map((p) => ({ c: p.c, r: p.r }));
}

export function buildTerrainBases(): { atlas: PixelBuffer; config: Record<string, { tiles: number[]; edgeColors: Array<[number, number, number]> }> } {
  const tiles: PixelBuffer[] = [];
  const config: Record<string, { tiles: number[]; edgeColors: Array<[number, number, number]> }> = {};
  const classOrder = ['deep', 'shallow', 'wetSand', 'drySand', 'grass', 'sparse', 'dense', 'mud', 'rock', 'cliff', 'path'];
  for (const cls of classOrder) {
    const file = path.join(GEN_DIR, `${cls}.png`);
    if (!fs.existsSync(file)) continue;
    const src = readPng(file);
    // Expect a square sheet; infer cell size: 8x8 grid of square cells.
    const grid = 8;
    const targetCell = 128;
    const norm = src.w === grid * targetCell && src.h === grid * targetCell ? src : nearestResize(src, grid * targetCell, grid * targetCell);
    if (norm.w < grid * targetCell || norm.h < grid * targetCell) {
      console.warn(`[real-assets] skip ${cls}: unexpected sheet size ${src.w}x${src.h}`);
      continue;
    }
    const variants: PixelBuffer[] = [];
    for (let vy = 0; vy < grid; vy++) {
      for (let vx = 0; vx < grid; vx++) {
        const t = createBuffer(32, 32, null);
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            // 4x NEAREST downscale: pick the pixel at (cellX*4 + x*4, cellY*4 + y*4).
            const [r, g, b, a] = getPx(norm, vx * targetCell + x * 4, vy * targetCell + y * 4);
            setPx(t, x, y, [r, g, b], a);
          }
        }
        variants.push(t);
      }
    }
    const sel = [0];
    const idxs: number[] = [];
    const edgeColors: Array<[number, number, number]> = [];
    for (const vi of sel) {
      // Wrap-seam: copy opposite edges so the tile repeats seamlessly.
      const t = applyWrapSeam(variants[vi]);
      const ec = edgeAvg(t);
      idxs.push(tiles.length);
      edgeColors.push(ec);
      tiles.push(t);
    }
    config[cls] = { tiles: idxs, edgeColors };
  }
  const atlas = atlasFromTiles(tiles, 12);
  return { atlas, config };
}

// --- Edge transition modules ---
// Each pair sheet (transitions/<A>-<B>.png) is an 8x8 grid:
// rows 0-3: A body with B strip on N/S/W/E; rows 4-7: B body with A strip.
// Extraction auto-verifies orientation and mirrors W for a missing E.

export type EdgeModuleKey = `${string}|${string}`;
export type EdgeModuleSet = Record<'N' | 'S' | 'W' | 'E', PixelBuffer>;

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

function mirrorV(t: PixelBuffer): PixelBuffer {
  const out = createBuffer(t.w, t.h, null);
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const [r, g, b, a] = getPx(t, x, t.h - 1 - y);
      setPx(out, x, y, [r, g, b], a);
    }
  }
  return out;
}

// Detect the strip side of one extracted tile by comparing 8px bands.
function detectStripSide(t: PixelBuffer): 'N' | 'S' | 'W' | 'E' | null {
  const bandAvg = (x0: number, y0: number, x1: number, y1: number): [number, number, number] => {
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
  };
  const top = bandAvg(0, 0, 32, 8);
  const bot = bandAvg(0, 24, 32, 32);
  const left = bandAvg(0, 0, 8, 32);
  const right = bandAvg(24, 0, 32, 32);
  // The strip is the band most different from the tile center.
  const center = bandAvg(12, 12, 20, 20);
  const d = (a: [number, number, number]) => (a[0] - center[0]) ** 2 + (a[1] - center[1]) ** 2 + (a[2] - center[2]) ** 2;
  const scores: Array<['N' | 'S' | 'W' | 'E', number]> = [
    ['N', d(top)],
    ['S', d(bot)],
    ['W', d(left)],
    ['E', d(right)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 900 ? scores[0][0] : null;
}

export function buildEdgeModules(): { modules: Map<EdgeModuleKey, EdgeModuleSet>; reverse: Map<EdgeModuleKey, EdgeModuleSet> } {
  const modules = new Map<EdgeModuleKey, EdgeModuleSet>();
  const reverse = new Map<EdgeModuleKey, EdgeModuleSet>();
  for (const [a, b] of TRANSITION_FILES) {
    const file = path.join(GEN_DIR, 'transitions', `${a}-${b}.png`);
    if (!fs.existsSync(file)) {
      console.warn(`[real-assets] missing transition sheet ${a}-${b}`);
      continue;
    }
    const src = readPng(file);
    const grid = 8;
    const targetCell = 128;
    const norm = src.w === grid * targetCell && src.h === grid * targetCell ? src : nearestResize(src, grid * targetCell, grid * targetCell);
    const extract = (row: number, side: 'N' | 'S' | 'W' | 'E'): PixelBuffer => {
      const t = createBuffer(32, 32, null);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const [r, g, b, a] = getPx(norm, x * 4, (row * targetCell) + y * 4);
          setPx(t, x, y, [r, g, b], a);
        }
      }
      const detected = detectStripSide(t);
      if (detected && detected !== side) {
        // Rotate the tile so the strip faces the expected side.
        if (detected === 'W' && side === 'E') return mirrorH(t);
        if (detected === 'E' && side === 'W') return mirrorH(t);
        if (detected === 'N' && side === 'S') return mirrorV(t);
        if (detected === 'S' && side === 'N') return mirrorV(t);
        if ((detected === 'N' || detected === 'S') && (side === 'W' || side === 'E')) return rotate90(t, detected === 'N' ? (side === 'W' ? 1 : 3) : side === 'W' ? 3 : 1);
        if ((detected === 'W' || detected === 'E') && (side === 'N' || side === 'S')) return rotate90(t, detected === 'W' ? (side === 'N' ? 3 : 1) : side === 'N' ? 1 : 3);
      }
      return t;
    };
    const aSet: EdgeModuleSet = {
      N: extract(0, 'N'),
      S: extract(1, 'S'),
      W: extract(2, 'W'),
      E: extract(3, 'E'),
    };
    const bSet: EdgeModuleSet = {
      N: extract(4, 'N'),
      S: extract(5, 'S'),
      W: extract(6, 'W'),
      E: extract(7, 'E'),
    };
    modules.set(`${a}|${b}`, aSet);
    reverse.set(`${b}|${a}`, bSet);
  }
  return { modules, reverse };
}

function rotate90(t: PixelBuffer, times: number): PixelBuffer {
  let cur = t;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) {
    const out = createBuffer(t.w, t.h, null);
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const [r, g, b, a] = getPx(cur, x, y);
        setPx(out, t.w - 1 - y, x, [r, g, b], a);
      }
    }
    cur = out;
  }
  return cur;
}

function edgeAvg(t: PixelBuffer): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < 32; i++) {
    for (const [x, y] of [[i, 0], [i, 31], [0, i], [31, i]] as Array<[number, number]>) {
      const [rr, gg, bb, a] = getPx(t, x, y);
      // Exclude dark outline pixels so the seam ring matches the body color.
      if (a > 0 && rr + gg + bb > 130) {
        r += rr;
        g += gg;
        b += bb;
        n++;
      }
    }
  }
  return n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
}

function applyWrapSeam(t: PixelBuffer): PixelBuffer {
  for (let i = 0; i < 32; i++) {
    for (const [ax, ay, bx, by] of [[0, i, 31, i], [31, i, 0, i], [i, 0, i, 31], [i, 31, i, 0]] as Array<[number, number, number, number]>) {
      const [r, g, b, a] = getPx(t, ax, ay);
      setPx(t, bx, by, [r, g, b], a);
    }
  }
  return t;
}

export function runRealAssets() {
  const { atlas, config } = buildTerrainBases();
  const outDir = path.join(__dirname, '../../assets/source/mvp2/normalized-32px');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'terrain-bases.png'), bufferToPng(atlas));
  fs.writeFileSync(path.join(outDir, 'terrain-bases.json'), JSON.stringify(config, null, 1));
  console.log('terrain bases written:', Object.keys(config).length, 'classes, atlas', atlas.w, 'x', atlas.h);
}

if (require.main === module) runRealAssets();
