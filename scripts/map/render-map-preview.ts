// Renders full-map PNG and a layer contact sheet for visual QA and the
// automatic texture checks (non-empty, entropy, flat-plane scan).

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { MAP_W, MAP_H } from './generate-map';
import { cellIndex, type RuntimeMap } from './map-types';

export function renderMapPixels(runtime: RuntimeMap, scale: number): { w: number; h: number; data: Buffer } {
  const terrainPng = PNG.sync.read(fs.readFileSync(path.join(__dirname, '../../public/generated/maps/aisland-mvp2/terrain.png')));
  const decalPng = PNG.sync.read(fs.readFileSync(path.join(__dirname, '../../public/generated/maps/aisland-mvp2/decals.png')));
  const terrainCols = Math.floor(terrainPng.width / 32);
  const decalCols = Math.floor(decalPng.width / 32);
  const out = new PNG({ width: MAP_W * scale, height: MAP_H * scale });
  const sample = (png: PNG, gid: number, cellX: number, cellY: number, px: number, py: number): [number, number, number, number] => {
    const cols = gid > 0 && png === terrainPng ? terrainCols : decalCols;
    const idx = gid - 1;
    if (idx < 0) return [0, 0, 0, 0];
    const tx = idx % cols;
    const ty = Math.floor(idx / cols);
    const i = ((ty * 32 + py) * png.width + tx * 32 + px) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
  };
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const ch = runtime.chunks[`${Math.floor(x / 32)},${Math.floor(y / 32)}`];
      const gid = ch.gids[(y % 32) * 32 + (x % 32)];
      const dgid = ch.decals[(y % 32) * 32 + (x % 32)];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = Math.floor((sx / scale) * 32);
          const py = Math.floor((sy / scale) * 32);
          let [r, g, b, a] = sample(terrainPng, gid, x, y, px, py);
          if (dgid > 0) {
            const [dr, dg, db, da] = sample(decalPng, dgid, x, y, px, py);
            if (da > 0) {
              const t = da / 255;
              r = Math.round(r * (1 - t) + dr * t);
              g = Math.round(g * (1 - t) + dg * t);
              b = Math.round(b * (1 - t) + db * t);
            }
          }
          const oi = ((y * scale + sy) * out.width + x * scale + sx) * 4;
          out.data[oi] = r;
          out.data[oi + 1] = g;
          out.data[oi + 2] = b;
          out.data[oi + 3] = a;
        }
      }
    }
  }
  return { w: out.width, h: out.height, data: out.data };
}

function gridLayer(runtime: RuntimeMap, kind: 'collision' | 'moveCost' | 'vision' | 'sound' | 'elevation'): PNG {
  const png = new PNG({ width: MAP_W, height: MAP_H });
  const maxV: Record<string, number> = { collision: 1, moveCost: 12, vision: 1, sound: 3, elevation: 5 };
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = cellIndex(x, y, MAP_W);
      let v: number;
      if (kind === 'collision') v = runtime.collision[i];
      else if (kind === 'moveCost') v = runtime.moveCost[i] / 4;
      else if (kind === 'vision') v = runtime.visionOpacity[i];
      else if (kind === 'sound') v = runtime.soundCost[i];
      else v = runtime.elevation[i];
      const t = Math.min(1, v / maxV[kind]);
      const r = Math.round(255 * t);
      const g = Math.round(120 * (1 - t) + 60);
      const b = Math.round(255 * (1 - t));
      const oi = (y * MAP_W + x) * 4;
      png.data[oi] = r;
      png.data[oi + 1] = g;
      png.data[oi + 2] = b;
      png.data[oi + 3] = 255;
    }
  }
  return png;
}

export function runPreview() {
  const root = path.join(__dirname, '../..');
  const runtime = JSON.parse(fs.readFileSync(path.join(root, 'public/generated/maps/aisland-mvp2/map.runtime.json'), 'utf8')) as RuntimeMap;
  const outDir = path.join(root, 'acceptance/mvp2/map');
  fs.mkdirSync(outDir, { recursive: true });

  const full = renderMapPixels(runtime, 8);
  const fullPng = new PNG({ width: full.w, height: full.h });
  fullPng.data = full.data;
  fs.writeFileSync(path.join(outDir, 'full-map.png'), PNG.sync.write(fullPng));

  // Contact sheet: terrain overview + 5 grid layers + objects summary.
  const layers: Array<[string, PNG]> = [
    ['terrain-8px', fullPng],
    ['collision', gridLayer(runtime, 'collision')],
    ['moveCost', gridLayer(runtime, 'moveCost')],
    ['visionOpacity', gridLayer(runtime, 'vision')],
    ['soundCost', gridLayer(runtime, 'sound')],
    ['elevation', gridLayer(runtime, 'elevation')],
  ];
  const cellW = 272;
  const cellH = 212;
  const cols = 3;
  const rows = Math.ceil(layers.length / cols);
  const sheet = new PNG({ width: cols * cellW, height: rows * cellH });
  sheet.data.fill(24);
  layers.forEach(([name, img], i) => {
    const cx = (i % cols) * cellW;
    const cy = Math.floor(i / cols) * cellH;
    const sx = (cellW - MAP_W) / 2;
    const sy = (cellH - MAP_H) / 2 - 8;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const si = (y * MAP_W + x) * 4;
        const di = ((cy + sy + y) * sheet.width + cx + sx + x) * 4;
        sheet.data[di] = img.data[si];
        sheet.data[di + 1] = img.data[si + 1];
        sheet.data[di + 2] = img.data[si + 2];
        sheet.data[di + 3] = 255;
      }
    }
    // label bar
    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < cellW; x++) {
        const di = ((cy + sy + MAP_H + 4 + y) * sheet.width + cx + x) * 4;
        sheet.data[di] = 40;
        sheet.data[di + 1] = 40;
        sheet.data[di + 2] = 40;
        sheet.data[di + 3] = 255;
      }
    }
    const label = name.padEnd(12, ' ');
    for (let li = 0; li < label.length; li++) {
      const ch = label.charCodeAt(li);
      if (ch >= 32) {
        const di = ((cy + sy + MAP_H + 7) * sheet.width + cx + 8 + li * 8) * 4;
        sheet.data[di] = 220;
        sheet.data[di + 1] = 220;
        sheet.data[di + 2] = 60;
      }
    }
  });
  fs.writeFileSync(path.join(outDir, 'layers-contact-sheet.png'), PNG.sync.write(sheet));
  console.log('preview written:', path.join(outDir, 'full-map.png'), path.join(outDir, 'layers-contact-sheet.png'));
}

if (require.main === module) runPreview();
