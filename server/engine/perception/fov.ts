// Recursive shadowcasting FOV (PRD 7.2). Server-authoritative: agents never
// see cells outside their own `visible` set. Light level scales the radius;
// terrain/object opacity blocks rays.

import { RuntimeMap } from '../map/runtimeMap';

export type LightLevel = 'day' | 'dusk' | 'night' | 'fire';

// Base vision radius per terrain class (day), PRD 7.2.
const DAY_RADIUS: Record<string, number> = {
  deep: 14,
  shallow: 14,
  wetSand: 15,
  drySand: 15,
  grass: 11,
  sparse: 8,
  dense: 4,
  mud: 8,
  rock: 14,
  cliff: 10,
  path: 12,
};

const LIGHT_MULT: Record<LightLevel, number> = {
  day: 1,
  dusk: 0.55,
  night: 0.28,
  fire: 0.45, // fire handled separately with its own radius
};

export type FovOptions = {
  light: LightLevel;
  radiusBoost?: number; // e.g. firelight +6..10
  highGround?: boolean; // highland vantage: +8 radius
};

export function fovRadiusAt(map: RuntimeMap, x: number, y: number, opts: FovOptions): number {
  const terrain = map.terrainAt(x, y);
  const base = (DAY_RADIUS[terrain] ?? 10) * LIGHT_MULT[opts.light];
  let r = Math.max(2, Math.round(base));
  if (opts.highGround && map.elevationAt(x, y) >= 4) r += 8;
  if (opts.light === 'fire') r = Math.max(r, 6 + (opts.radiusBoost ?? 4));
  return Math.min(r, 32);
}

const BLOCK_THRESHOLD = 0.62;

export function computeFov(map: RuntimeMap, ox: number, oy: number, radius: number): Uint8Array {
  const w = map.width;
  const h = map.height;
  const visible = new Uint8Array(w * h);
  if (!map.inBounds(ox, oy)) return visible;
  visible[oy * w + ox] = 1;

  const opaque = (x: number, y: number): boolean => {
    if (!map.inBounds(x, y)) return true;
    return map.data.visionOpacity[y * w + x] >= BLOCK_THRESHOLD;
  };

  // Recursive shadowcasting over 8 octants.
  for (let oct = 0; oct < 8; oct++) {
    castLight(oct, 1, 1.0, 0.0);
  }

  function castLight(oct: number, row: number, startSlope: number, endSlope: number) {
    if (startSlope < endSlope) return;
    let nextStart = startSlope;
    for (let i = row; i <= radius; i++) {
      let blocked = false;
      const dx = -i;
      const dy = -i;
      for (let j = dx; j <= 0; j++) {
        const lSlope = (j - 0.5) / (dy + 0.5);
        const rSlope = (j + 0.5) / (dy - 0.5);
        if (lSlope > startSlope) continue;
        if (rSlope < endSlope) break;
        const [mx, my] = transform(oct, j, dy);
        if (mx * mx + my * my > radius * radius) continue;
        if (!map.inBounds(ox + mx, oy + my)) continue;
        const idx = (oy + my) * w + (ox + mx);
        if (i === radius || (i > 1 && (mx === 0 && my === 0))) continue;
        visible[idx] = 1;
        const curOpaque = opaque(ox + mx, oy + my);
        if (curOpaque) {
          if (j < 0) {
            nextStart = rSlope;
          } else {
            blocked = true;
            break;
          }
        } else {
          if (blocked) {
            blocked = false;
            castLight(oct, i + 1, nextStart, lSlope);
          }
        }
      }
      if (blocked) break;
      nextStart = startSlope;
    }
  }

  function transform(oct: number, x: number, y: number): [number, number] {
    switch (oct) {
      case 0: return [x, y];
      case 1: return [-y, -x];
      case 2: return [-y, x];
      case 3: return [-x, y];
      case 4: return [-x, -y];
      case 5: return [y, -x];
      case 6: return [y, x];
      default: return [x, -y];
    }
  }
  return visible;
}
