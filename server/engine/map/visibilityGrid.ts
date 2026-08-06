// FOV / visibility scaffolding (P2 will complete shadowcasting + fog state).
// Kept server-authoritative: agents only read PerceptionSnapshot built here.

import { RuntimeMap } from './runtimeMap';

export type FovResult = {
  visible: Uint8Array;
  explored: Uint8Array;
};

// Simple ray-marched LOS for one origin; full recursive shadowcasting lands in
// P2 (perception/fov.ts). This version is used by unit tests only.
export function computeVisibleCells(map: RuntimeMap, ox: number, oy: number, radius: number): Uint8Array {
  const n = map.width * map.height;
  const out = new Uint8Array(n);
  const x0 = Math.max(0, ox - radius);
  const x1 = Math.min(map.width - 1, ox + radius);
  const y0 = Math.max(0, oy - radius);
  const y1 = Math.min(map.height - 1, oy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ox;
      const dy = y - oy;
      if (dx * dx + dy * dy > radius * radius) continue;
      // Bresenham line; stop at first opaque cell.
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      let visible = true;
      for (let s = 1; s <= steps; s++) {
        const px = Math.round(ox + (dx * s) / steps);
        const py = Math.round(oy + (dy * s) / steps);
        if (map.data.visionOpacity[map.idx(px, py)] >= 1) {
          visible = false;
          break;
        }
      }
      if (visible) out[map.idx(x, y)] = 1;
    }
  }
  out[map.idx(ox, oy)] = 1;
  return out;
}
