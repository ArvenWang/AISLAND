// Deterministic pixel-art generation for AISLAND MVP2.
// All textures are produced procedurally with a unified palette (no AI
// generation, no runtime mixing). Character frames are extracted from the
// CC0 Ninja Adventure pack and palette-swapped.

import { PNG } from 'pngjs';

export type RGB = [number, number, number];
export type PixelBuffer = { w: number; h: number; data: Uint8ClampedArray };

export function createBuffer(w: number, h: number, fill: RGB | null = null): PixelBuffer {
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill) {
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = fill[0];
      data[i * 4 + 1] = fill[1];
      data[i * 4 + 2] = fill[2];
      data[i * 4 + 3] = 255;
    }
  }
  return { w, h, data };
}

export function setPx(b: PixelBuffer, x: number, y: number, c: RGB, a = 255) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i = (y * b.w + x) * 4;
  b.data[i] = c[0];
  b.data[i + 1] = c[1];
  b.data[i + 2] = c[2];
  b.data[i + 3] = a;
}

export function getPx(b: PixelBuffer, x: number, y: number): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return [0, 0, 0, 0];
  const i = (y * b.w + x) * 4;
  return [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]];
}

export function fillRect(b: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPx(b, x, y, c, a);
}

export function blendPixel(b: PixelBuffer, x: number, y: number, c: RGB, alpha: number) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i = (y * b.w + x) * 4;
  const a = alpha / 255;
  b.data[i] = Math.round(b.data[i] * (1 - a) + c[0] * a);
  b.data[i + 1] = Math.round(b.data[i + 1] * (1 - a) + c[1] * a);
  b.data[i + 2] = Math.round(b.data[i + 2] * (1 - a) + c[2] * a);
  b.data[i + 3] = 255;
}

// Deterministic PRNG (mulberry32) with string hashing.
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: number, salt: string): () => number {
  return mulberry32((seed ^ hashString(salt)) >>> 0);
}

// Smooth value noise: grid of random values, bilinear interp with octaves.
export function makeNoise(seed: number, salt: string, cell = 12, octaves = 3): (x: number, y: number) => number {
  const rng = makeRng(seed, salt);
  const gw = Math.ceil(512 / cell) + 2;
  const grids: number[][] = [];
  let size = cell;
  for (let o = 0; o < octaves; o++) {
    const g: number[] = [];
    for (let i = 0; i < gw * gw; i++) g.push(rng());
    grids.push(g);
    size = Math.max(2, Math.floor(size / 2));
  }
  return (x: number, y: number) => {
    let amp = 1;
    let total = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const c = Math.max(2, cell >> o);
      const gx = x / c;
      const gy = y / c;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const g = grids[o];
      const at = (ix: number, iy: number) => g[((iy + gw) % gw) * gw + ((ix + gw) % gw)];
      const v = (1 - fx) * (1 - fy) * at(x0, y0) + fx * (1 - fy) * at(x0 + 1, y0) + (1 - fx) * fy * at(x0, y0 + 1) + fx * fy * at(x0 + 1, y0 + 1);
      total += v * amp;
      norm += amp;
      amp *= 0.5;
    }
    return total / norm;
  };
}

// Palette (unified, Calciumtrice-inspired).
export const PAL = {
  deepWater: [28, 60, 108] as RGB,
  deepWater2: [34, 74, 124] as RGB,
  shallowWater: [66, 128, 168] as RGB,
  shallowWater2: [92, 158, 190] as RGB,
  foam: [222, 238, 242] as RGB,
  wetSand: [146, 128, 98] as RGB,
  wetSand2: [160, 142, 108] as RGB,
  drySand: [214, 196, 152] as RGB,
  drySand2: [228, 212, 168] as RGB,
  drySand3: [198, 178, 134] as RGB,
  grass: [92, 148, 70] as RGB,
  grass2: [104, 160, 78] as RGB,
  grassDark: [76, 128, 58] as RGB,
  sparseFloor: [72, 122, 60] as RGB,
  sparseFloor2: [62, 112, 54] as RGB,
  denseFloor: [44, 86, 46] as RGB,
  denseFloor2: [36, 74, 40] as RGB,
  mud: [108, 92, 70] as RGB,
  mud2: [122, 104, 80] as RGB,
  mudDark: [88, 74, 56] as RGB,
  rock: [128, 126, 122] as RGB,
  rock2: [146, 144, 140] as RGB,
  rockDark: [100, 98, 96] as RGB,
  cliff: [90, 88, 86] as RGB,
  cliffDark: [62, 60, 60] as RGB,
  cliffLight: [150, 146, 140] as RGB,
  trunk: [92, 64, 46] as RGB,
  trunkDark: [68, 46, 34] as RGB,
  leafA: [70, 118, 54] as RGB,
  leafB: [88, 138, 62] as RGB,
  leafC: [56, 96, 46] as RGB,
  berry: [178, 52, 60] as RGB,
  berryDark: [130, 38, 46] as RGB,
  itemWater: [74, 150, 214] as RGB,
  itemWaterDark: [46, 108, 168] as RGB,
  itemFood: [168, 118, 66] as RGB,
  itemFoodDark: [126, 86, 46] as RGB,
  itemWood: [132, 94, 54] as RGB,
  itemWoodDark: [98, 68, 40] as RGB,
  itemCloth: [206, 194, 168] as RGB,
  itemMetal: [176, 178, 182] as RGB,
  itemMetalDark: [124, 126, 132] as RGB,
  fireA: [240, 148, 48] as RGB,
  fireB: [252, 196, 78] as RGB,
  fireC: [214, 82, 36] as RGB,
  ember: [120, 44, 26] as RGB,
  wreckDark: [66, 62, 58] as RGB,
  wreckMid: [104, 98, 92] as RGB,
  wreckLight: [152, 144, 136] as RGB,
  shadow: [0, 0, 0] as RGB,
};

function speckle(b: PixelBuffer, rng: () => number, colors: RGB[], density: number) {
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (rng() < density) {
        const c = colors[Math.floor(rng() * colors.length)];
        blendPixel(b, x, y, c, 90 + rng() * 80);
      }
    }
  }
}

export function baseTexture(kind: string, rng: () => number): PixelBuffer {
  const b = createBuffer(32, 32);
  switch (kind) {
    case 'deep': {
      fillRect(b, 0, 0, 31, 31, PAL.deepWater);
      // subtle wave bands
      for (let y = 0; y < 32; y++) {
        const shade = rng() < 0.5 ? PAL.deepWater2 : PAL.deepWater;
        for (let x = 0; x < 32; x++) {
          if ((x + y * 2 + Math.floor(rng() * 3)) % 11 === 0) blendPixel(b, x, y, shade, 60);
        }
      }
      speckle(b, rng, [PAL.deepWater2], 0.12);
      break;
    }
    case 'shallow': {
      fillRect(b, 0, 0, 31, 31, PAL.shallowWater);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if ((x + Math.floor(y / 3) + Math.floor(rng() * 2)) % 9 === 0) blendPixel(b, x, y, PAL.shallowWater2, 70);
          if (rng() < 0.02) blendPixel(b, x, y, PAL.foam, 110);
        }
      }
      break;
    }
    case 'wetSand': {
      fillRect(b, 0, 0, 31, 31, PAL.wetSand);
      speckle(b, rng, [PAL.wetSand2, PAL.wetSand2, PAL.drySand3], 0.35);
      // ripples
      for (let y = 2; y < 30; y += 5) {
        const x0 = Math.floor(rng() * 6);
        for (let x = x0; x < 32; x += 7) blendPixel(b, x, y, PAL.wetSand2, 120);
      }
      break;
    }
    case 'drySand': {
      fillRect(b, 0, 0, 31, 31, PAL.drySand);
      speckle(b, rng, [PAL.drySand2, PAL.drySand3, PAL.drySand2], 0.5);
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(rng() * 30);
        const y = Math.floor(rng() * 30);
        setPx(b, x, y, PAL.drySand3);
        setPx(b, x + 1, y, PAL.drySand3);
      }
      break;
    }
    case 'grass': {
      fillRect(b, 0, 0, 31, 31, PAL.grass);
      speckle(b, rng, [PAL.grass2, PAL.grassDark, PAL.grass2], 0.5);
      // tiny blades
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(rng() * 31);
        const y = Math.floor(rng() * 31);
        blendPixel(b, x, y, PAL.grassDark, 210);
        blendPixel(b, x + 1, y - 1, PAL.grassDark, 170);
      }
      break;
    }
    case 'sparse': {
      fillRect(b, 0, 0, 31, 31, PAL.sparseFloor);
      speckle(b, rng, [PAL.sparseFloor2, PAL.grassDark, PAL.grass], 0.55);
      // leaf litter
      for (let i = 0; i < 8; i++) {
        const x = Math.floor(rng() * 30);
        const y = Math.floor(rng() * 30);
        blendPixel(b, x, y, PAL.leafC, 200);
        blendPixel(b, x + 1, y + 1, PAL.leafC, 160);
      }
      break;
    }
    case 'dense': {
      fillRect(b, 0, 0, 31, 31, PAL.denseFloor);
      speckle(b, rng, [PAL.denseFloor2, PAL.sparseFloor2, PAL.leafC], 0.6);
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(rng() * 30);
        const y = Math.floor(rng() * 30);
        setPx(b, x, y, PAL.leafC);
        setPx(b, x + 1, y, PAL.leafC);
      }
      break;
    }
    case 'mud': {
      fillRect(b, 0, 0, 31, 31, PAL.mud);
      speckle(b, rng, [PAL.mud2, PAL.mudDark, PAL.mud2], 0.5);
      for (let y = 3; y < 30; y += 6) {
        for (let x = 2 + Math.floor(rng() * 3); x < 30; x += 8) {
          blendPixel(b, x, y, PAL.mudDark, 150);
        }
      }
      break;
    }
    case 'rock': {
      fillRect(b, 0, 0, 31, 31, PAL.rock);
      speckle(b, rng, [PAL.rock2, PAL.rockDark, PAL.rock2], 0.5);
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(rng() * 28);
        const y = Math.floor(rng() * 28);
        setPx(b, x, y, PAL.rockDark);
        setPx(b, x + 2, y + 1, PAL.rock2);
      }
      break;
    }
    case 'path': {
      // worn dirt path over grass base
      fillRect(b, 0, 0, 31, 31, PAL.grass);
      speckle(b, rng, [PAL.mud2, PAL.mud, PAL.drySand3], 0.7);
      break;
    }
    case 'cliff': {
      fillRect(b, 0, 0, 31, 31, PAL.cliff);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const band = (x + Math.floor(y / 2)) % 8;
          const c = band < 2 ? PAL.cliffDark : band < 5 ? PAL.cliff : PAL.cliffLight;
          blendPixel(b, x, y, c, 140);
        }
      }
      speckle(b, rng, [PAL.cliffDark, PAL.cliffLight], 0.2);
      break;
    }
    default:
      fillRect(b, 0, 0, 31, 31, [255, 0, 255]);
  }
  return b;
}

// --- Props / items (32x32 or taller) ---

export function treeSprite(rng: () => number, variant: number): PixelBuffer {
  const b = createBuffer(48, 64, null);
  // trunk (14 wide)
  fillRect(b, 17, 38, 30, 55, PAL.trunk);
  fillRect(b, 15, 52, 32, 55, PAL.trunkDark);
  for (let y = 39; y < 54; y++) if (rng() < 0.25) setPx(b, 17 + Math.floor(rng() * 14), y, PAL.trunkDark);
  // canopy: 3 blobs
  const blobs: Array<[number, number, number, RGB, RGB]> = [
    [24, 24, 17, PAL.leafB, PAL.leafA],
    [12, 34, 14, PAL.leafA, PAL.leafC],
    [36, 34, 14, PAL.leafA, PAL.leafC],
  ];
  if (variant === 1) blobs[0] = [26, 22, 19, PAL.leafA, PAL.leafC];
  if (variant === 2) blobs[0] = [24, 26, 16, PAL.leafC, PAL.leafB];
  for (const [cx, cy, r, c1, c2] of blobs) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r + rng() * 4) {
          const c = (x * y) % 5 === 0 ? c2 : c1;
          setPx(b, cx + x, cy + y, c);
        }
      }
    }
  }
  // highlights
  for (let i = 0; i < 14; i++) {
    const x = 12 + Math.floor(rng() * 25);
    const y = 12 + Math.floor(rng() * 18);
    if (getPx(b, x, y)[3] > 0) blendPixel(b, x, y, PAL.leafB, 70);
  }
  return b;
}

export function rockSprite(rng: () => number, big = false): PixelBuffer {
  const s = big ? 40 : 26;
  const b = createBuffer(40, 28, null);
  const cx = 20;
  const cy = big ? 20 : 18;
  const rx = big ? 15 : 11;
  const ry = big ? 11 : 8;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < 40; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1 + rng() * 0.25) {
        const c = y < cy - ry * 0.3 ? PAL.rock2 : y > cy + ry * 0.3 ? PAL.rockDark : PAL.rock;
        setPx(b, x, y, c);
      }
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(cx - rx + rng() * rx * 2);
    const y = Math.floor(cy - ry + rng() * ry * 1.2);
    setPx(b, x, y, PAL.rockDark, 160);
  }
  return b;
}

export function berryBushSprite(rng: () => number): PixelBuffer {
  const b = createBuffer(32, 28, null);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = (x - 16) / 14;
      const dy = (y - 12) / 9;
      if (dx * dx + dy * dy <= 1 + rng() * 0.2) {
        const c = y > 16 ? PAL.leafC : x % 7 === 0 ? PAL.leafB : PAL.leafA;
        setPx(b, x, y, c);
      }
    }
  }
  for (let i = 0; i < 7; i++) {
    const x = 6 + Math.floor(rng() * 20);
    const y = 10 + Math.floor(rng() * 10);
    setPx(b, x, y, PAL.berry);
    setPx(b, x + 1, y, PAL.berryDark, 200);
  }
  return b;
}

export function woodLogSprite(): PixelBuffer {
  const b = createBuffer(30, 16, null);
  fillRect(b, 2, 5, 27, 11, PAL.itemWoodDark);
  fillRect(b, 3, 6, 26, 10, PAL.itemWood);
  // end caps
  fillRect(b, 3, 6, 6, 10, PAL.itemWoodDark);
  fillRect(b, 23, 6, 26, 10, PAL.itemWoodDark);
  for (let x = 8; x < 22; x += 4) setPx(b, x, 8, PAL.itemWoodDark, 180);
  return b;
}

export function waterBottleSprite(): PixelBuffer {
  const b = createBuffer(14, 22, null);
  fillRect(b, 4, 0, 9, 3, PAL.itemMetal);
  fillRect(b, 5, 4, 8, 6, PAL.itemMetalDark);
  fillRect(b, 5, 7, 8, 20, PAL.itemWater);
  fillRect(b, 5, 16, 8, 20, PAL.itemWaterDark);
  blendPixel(b, 6, 9, PAL.foam, 90);
  return b;
}

export function foodRationSprite(): PixelBuffer {
  const b = createBuffer(18, 12, null);
  fillRect(b, 2, 3, 15, 8, PAL.itemFood);
  fillRect(b, 3, 4, 14, 7, PAL.itemFoodDark);
  fillRect(b, 2, 3, 15, 3, PAL.itemCloth);
  return b;
}

export function lighterSprite(): PixelBuffer {
  const b = createBuffer(10, 18, null);
  fillRect(b, 2, 12, 7, 17, PAL.itemMetal);
  fillRect(b, 3, 5, 6, 11, PAL.fireC);
  fillRect(b, 4, 0, 5, 4, PAL.itemMetalDark);
  return b;
}

export function tinderSprite(): PixelBuffer {
  const b = createBuffer(16, 12, null);
  fillRect(b, 3, 3, 12, 8, PAL.itemCloth);
  for (let y = 4; y < 8; y++) for (let x = 4; x < 12; x += 3) setPx(b, x, y, PAL.itemWoodDark, 140);
  return b;
}

export function backpackSprite(): PixelBuffer {
  const b = createBuffer(18, 22, null);
  fillRect(b, 3, 5, 14, 20, PAL.itemFoodDark);
  fillRect(b, 4, 6, 13, 19, PAL.itemFood);
  fillRect(b, 6, 3, 11, 6, PAL.itemFoodDark);
  fillRect(b, 7, 2, 10, 5, PAL.itemWood);
  return b;
}

export function wreckageSprite(rng: () => number): PixelBuffer {
  const b = createBuffer(64, 36, null);
  // hull fragment
  for (let y = 8; y < 30; y++) {
    for (let x = 2; x < 62; x++) {
      const inside = x > 4 + rng() * 3 && x < 58 - rng() * 3 && y > 10 + rng() * 2 && y < 28 - rng() * 2;
      if (inside) {
        const c = (x * 7 + y * 3) % 9 === 0 ? PAL.wreckLight : (x * 5 + y * 11) % 13 === 0 ? PAL.wreckDark : PAL.wreckMid;
        setPx(b, x, y, c);
      }
    }
  }
  // torn edge highlight
  for (let x = 6; x < 58; x += 5) setPx(b, x, 10, PAL.wreckLight);
  // window
  fillRect(b, 24, 14, 38, 22, PAL.deepWater);
  fillRect(b, 26, 16, 36, 20, PAL.shallowWater2);
  return b;
}

export function fireSprite(frame: number): PixelBuffer {
  // 32x32 flame animation (4 frames) + ember base
  const b = createBuffer(32, 32, null);
  // logs
  fillRect(b, 6, 22, 25, 25, PAL.itemWoodDark);
  fillRect(b, 7, 23, 24, 24, PAL.itemWood);
  fillRect(b, 10, 25, 21, 27, PAL.itemWoodDark);
  fillRect(b, 5, 26, 12, 27, PAL.itemWood);
  const rng = mulberry32(11 + frame * 97);
  const flameH = 8 + frame * 2 + Math.floor(rng() * 4);
  for (let y = 24 - flameH; y < 24; y++) {
    for (let x = 10; x < 22; x++) {
      const dx = (x - 16) / 6;
      const dy = (y - 23) / flameH;
      if (dx * dx + dy * dy <= 1) {
        const t = (y - (24 - flameH)) / flameH;
        const c = t < 0.35 ? PAL.fireC : t < 0.7 ? PAL.fireA : PAL.fireB;
        setPx(b, x, y, c, 240);
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = 8 + Math.floor(rng() * 16);
    const y = 12 + Math.floor(rng() * 10);
    if (rng() < 0.6) setPx(b, x, y, PAL.fireB, 220);
  }
  return b;
}

export function cliffFaceTexture(rng: () => number): PixelBuffer {
  const b = createBuffer(32, 32);
  fillRect(b, 0, 0, 31, 31, PAL.cliff);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const band = (x + Math.floor(y / 2)) % 8;
      const c = band < 2 ? PAL.cliffDark : band < 5 ? PAL.cliff : PAL.cliffLight;
      blendPixel(b, x, y, c, 130);
    }
  }
  speckle(b, rng, [PAL.cliffDark, PAL.cliffLight], 0.2);
  return b;
}

// --- PNG encoding ---

export function bufferToPng(b: PixelBuffer): Buffer {
  const png = new PNG({ width: b.w, height: b.h });
  png.data.set(b.data);
  return PNG.sync.write(png);
}

export function atlasFromTiles(tiles: PixelBuffer[], cols: number): PixelBuffer {
  const maxW = Math.max(32, ...tiles.map((t) => t.w));
  const maxH = Math.max(32, ...tiles.map((t) => t.h));
  const cell = Math.max(maxW, maxH);
  const rows = Math.ceil(tiles.length / cols);
  const out = createBuffer(cols * cell, rows * cell, null);
  tiles.forEach((tile, i) => {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    for (let y = 0; y < tile.h; y++) {
      for (let x = 0; x < tile.w; x++) {
        const [r, g, b, a] = getPx(tile, x, y);
        setPx(out, cx + x, cy + y, [r, g, b], a);
      }
    }
  });
  return out;
}

export function nearestScale(b: PixelBuffer, factor: number): PixelBuffer {
  const out = createBuffer(b.w * factor, b.h * factor, null);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const [r, g, bl, a] = getPx(b, Math.floor(x / factor), Math.floor(y / factor));
      setPx(out, x, y, [r, g, bl], a);
    }
  }
  return out;
}

// Palette-swap a character sheet: map source color -> target color.
export function paletteSwap(b: PixelBuffer, mapping: Array<[RGB, RGB]>): PixelBuffer {
  const out = createBuffer(b.w, b.h, null);
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const [r, g, bl, a] = getPx(b, x, y);
      if (a === 0) continue;
      let c: RGB = [r, g, bl];
      for (const [from, to] of mapping) {
        if (Math.abs(r - from[0]) <= 12 && Math.abs(g - from[1]) <= 12 && Math.abs(bl - from[2]) <= 12) {
          c = to;
          break;
        }
      }
      setPx(out, x, y, c, a);
    }
  }
  return out;
}
