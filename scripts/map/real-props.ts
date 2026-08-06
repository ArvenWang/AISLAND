// Real props assembly: Calciumtrice trees (CC-BY 4.0), Zoria chests/rocks
// (CC-BY 4.0), AI-generated pixel-art items/props (chroma-keyed). Outputs
// normalized-32px/props.png + props.meta.json used by MapScene.

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { atlasFromTiles, bufferToPng, createBuffer, getPx, setPx, type PixelBuffer } from './pixel-art';

const SRC = path.join(__dirname, '../../assets/source/mvp2/original');

function readPng(p: string): PixelBuffer {
  const png = PNG.sync.read(fs.readFileSync(p));
  return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data) };
}

function lanczosDownscale(src: PixelBuffer, tw: number, th: number): PixelBuffer {
  const sx = src.w / tw;
  const sy = src.h / th;
  const out = createBuffer(tw, th, null);
  const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const tap = (x: number) => {
    const a = x === 0 ? 1 : sinc(x) * sinc(x / 3);
    return Math.abs(x) < 3 ? a : 0;
  };
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const cx = (x + 0.5) * sx - 0.5;
      const cy = (y + 0.5) * sy - 0.5;
      const x0 = Math.max(0, Math.floor(cx - 3 * sx));
      const x1 = Math.min(src.w - 1, Math.ceil(cx + 3 * sx));
      const y0 = Math.max(0, Math.floor(cy - 3 * sy));
      const y1 = Math.min(src.h - 1, Math.ceil(cy + 3 * sy));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const wx = tap((xx - cx) / sx);
          const wy = tap((yy - cy) / sy);
          const w = wx * wy;
          if (w === 0) continue;
          const [rr, gg, bb, aa] = getPx(src, xx, yy);
          r += rr * w * (aa / 255);
          g += gg * w * (aa / 255);
          b += bb * w * (aa / 255);
          a += aa * w;
          wsum += w;
        }
      }
      if (wsum > 0) {
        setPx(out, x, y, [Math.round(r / wsum), Math.round(g / wsum), Math.round(b / wsum)], Math.round(a / wsum));
      }
    }
  }
  return out;
}

function cropTiles(buf: PixelBuffer, ts: number, indices: Array<{ c: number; r: number }>): PixelBuffer[] {
  return indices.map(({ c, r }) => {
    const out = createBuffer(ts, ts, null);
    for (let y = 0; y < ts; y++) {
      for (let x = 0; x < ts; x++) {
        const [rr, g, b, a] = getPx(buf, c * ts + x, r * ts + y);
        setPx(out, x, y, [rr, g, b], a);
      }
    }
    return out;
  });
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

function trimTransparent(buf: PixelBuffer): PixelBuffer {
  let x0 = buf.w;
  let y0 = buf.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      if (getPx(buf, x, y)[3] > 8) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return buf;
  const out = createBuffer(x1 - x0 + 1, y1 - y0 + 1, null);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const [r, g, b, a] = getPx(buf, x0 + x, y0 + y);
      setPx(out, x, y, [r, g, b], a);
    }
  }
  return out;
}

export function buildRealProps(): { propsPng: Buffer; effectsPng: Buffer; meta: unknown } {
  const tiles: PixelBuffer[] = [];
  const propMeta: Record<string, { tile: number }> = {};
  const itemMeta: Record<string, { tile: number }> = {};
  const add = (name: string, t: PixelBuffer, section: 'props' | 'items') => {
    const idx = tiles.length;
    tiles.push(t);
    if (section === 'props') propMeta[name] = { tile: idx };
    else itemMeta[name] = { tile: idx };
  };

  // Calciumtrice trees (96x112 real sprites).
  const trees = readPng(path.join(SRC, 'calciumtrice-outdoor/trees_23.png'));
  for (let i = 0; i < 6; i++) {
    const t = createBuffer(96, 112, null);
    for (let y = 0; y < 112; y++) {
      for (let x = 0; x < 96; x++) {
        const [r, g, b, a] = getPx(trees, (i % 2) * 96 + x, Math.floor(i / 2) * 112 + y);
        setPx(t, x, y, [r, g, b], a);
      }
    }
    add(`tree_${i}`, t, 'props');
  }

  // Zoria chests & rocks (16px -> 32px).
  const zoria = readPng(path.join(SRC, 'zoria/overworld.png'));
  const zTiles = (indices: Array<{ c: number; r: number }>) => cropTiles(zoria, 16, indices).map(upscale2);
  const [chestA, chestB, rockA, rockB] = zTiles([
    { c: 16, r: 4 },
    { c: 16, r: 5 },
    { c: 9, r: 1 },
    { c: 10, r: 1 },
  ]);
  add('crate', chestA, 'props');
  add('crate_open', chestB, 'props');
  add('rock', rockA, 'props');
  add('rock_alt', rockB, 'props');

  // AI pixel-art props (chroma-keyed, magenta removed).
  const gen = path.join(SRC, 'generated-props/transparent');
  const genNames = ['water_bottle', 'food_ration', 'lighter', 'tinder', 'backpack', 'berry_bush', 'spring', 'campfire', 'wood_log', 'wreckage'] as const;
  const target: Record<string, number> = {
    water_bottle: 32,
    food_ration: 32,
    lighter: 32,
    tinder: 32,
    backpack: 32,
    berry_bush: 48,
    spring: 48,
    campfire: 48,
    wood_log: 48,
    wreckage: 64,
  };
  for (const name of genNames) {
    const file = path.join(gen, `${name}.png`);
    if (!fs.existsSync(file)) continue;
    let t = readPng(file);
    t = trimTransparent(t);
    const size = target[name];
    t = t.w > size || t.h > size ? lanczosDownscale(t, size, size) : t;
    add(name, t, 'items');
  }

  const propsAtlas = atlasFromTiles(tiles, 8);
  const meta = {
    version: 'props-v2-real',
    props: propMeta,
    items: itemMeta,
    tileSizes: tiles.map((t) => [t.w, t.h]),
    cellSize: Math.max(32, ...tiles.map((t) => Math.max(t.w, t.h))),
  };
  const emptyFx = createBuffer(32, 32, null);
  return { propsPng: bufferToPng(propsAtlas), effectsPng: bufferToPng(atlasFromTiles([emptyFx], 4)), meta };
}

export function runRealProps() {
  const { propsPng, meta } = buildRealProps();
  const outDir = path.join(__dirname, '../../assets/source/mvp2/normalized-32px');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'props.png'), propsPng);
  fs.writeFileSync(path.join(outDir, 'props.meta.json'), JSON.stringify(meta, null, 1));
  const tiles = Object.keys(meta.props as Record<string, unknown>).length + Object.keys(meta.items as Record<string, unknown>).length;
  console.log('real props written:', tiles, 'sprites');
}

if (require.main === module) runRealProps();
