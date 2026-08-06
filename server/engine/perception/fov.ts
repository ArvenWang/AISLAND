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

  // Ray-cast LOS per cell (equivalent grid LOS; deterministic and cheap for
  // 3 agents). Opaque intermediate cells block; the target cell itself is
  // visible even when opaque.
  const x0 = Math.max(0, ox - radius);
  const x1 = Math.min(w - 1, ox + radius);
  const y0 = Math.max(0, oy - radius);
  const y1 = Math.min(h - 1, oy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ox;
      const dy = y - oy;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (dx === 0 && dy === 0) continue;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      let blocked = false;
      for (let s = 1; s < steps; s++) {
        const px = ox + Math.round((dx * s) / steps);
        const py = oy + Math.round((dy * s) / steps);
        if (map.data.visionOpacity[py * w + px] >= BLOCK_THRESHOLD) {
          blocked = true;
          break;
        }
      }
      if (!blocked) visible[y * w + x] = 1;
    }
  }
  return visible;
}
