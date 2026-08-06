// Pathfinding over the runtime map. A* with an `allowed` predicate so unknown
// (unexplored) cells can be excluded (knowledge isolation, PRD 8.6).

import { RuntimeMap } from './runtimeMap';

export type PathOptions = {
  allowed?: (x: number, y: number) => boolean;
  maxCost?: number;
};

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function findPath(map: RuntimeMap, from: { x: number; y: number }, to: { x: number; y: number }, opts: PathOptions = {}): Array<{ x: number; y: number }> | null {
  if (!map.inBounds(from.x, from.y) || !map.inBounds(to.x, to.y)) return null;
  const allowed = opts.allowed ?? (() => true);
  const w = map.width;
  const n = w * map.height;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = map.idx(from.x, from.y);
  const goal = map.idx(to.x, to.y);
  g[start] = 0;
  const heap: number[] = [];
  const f = (i: number) => g[i] + Math.abs((i % w) - to.x) + Math.abs((i / w) - to.y);
  const push = (i: number) => {
    let k = heap.length;
    heap.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f(heap[p]) <= f(heap[k])) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && f(heap[l]) < f(heap[m])) m = l;
        if (r < heap.length && f(heap[r]) < f(heap[m])) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  push(start);
  while (heap.length) {
    const cur = pop();
    if (cur === goal) {
      const out: Array<{ x: number; y: number }> = [];
      let c = cur;
      while (c !== -1) {
        out.push({ x: c % w, y: Math.floor(c / w) });
        c = prev[c];
      }
      return out.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (closed[ni]) continue;
      if (map.isBlocked(nx, ny) || !allowed(nx, ny)) continue;
      const cost = map.moveCost(nx, ny);
      const nd = g[cur] + cost;
      if (nd < g[ni]) {
        g[ni] = nd;
        prev[ni] = cur;
        push(ni);
      }
    }
  }
  return null;
}

export function pathCost(map: RuntimeMap, path: Array<{ x: number; y: number }>): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += map.moveCost(path[i].x, path[i].y);
  }
  return total;
}
