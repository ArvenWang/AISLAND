// Sound propagation (PRD 9.2): weighted flood fill over the SOUND_COST grid.
// Beach 0.7, grass 1.0, sparse 1.4, dense 2.1, cliff/walls blocked.

import { Mvp2World } from './types';

export type HeardSound = {
  sourceEventId: string;
  sourceActorId: string;
  listenerId: string;
  text: string;
  bearing: string;
  distanceClass: 'near' | 'medium' | 'far';
  clarity: number;
};

const MAX_SOUND_COST = 34;

export function bearingLabel(dx: number, dy: number): string {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(((deg + 360) % 360) / 45) % 8];
}

export function propagateSound(world: Mvp2World, sourceX: number, sourceY: number, text: string, sourceEventId: string, sourceActorId: string): HeardSound[] {
  const map = world.map;
  const w = map.width;
  const n = w * map.height;
  const cost = new Float32Array(n).fill(Infinity);
  const visited = new Uint8Array(n);
  const heap: number[] = [];
  const s = sourceY * w + sourceX;
  cost[s] = 0;
  const push = (i: number) => {
    let k = heap.length;
    heap.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (cost[heap[p]] <= cost[heap[k]]) break;
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
        if (l < heap.length && cost[heap[l]] < cost[heap[m]]) m = l;
        if (r < heap.length && cost[heap[r]] < cost[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  push(s);
  while (heap.length) {
    const cur = pop();
    if (visited[cur]) continue;
    visited[cur] = 1;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
      const ni = ny * w + nx;
      if (visited[ni]) continue;
      const edge = map.data.soundCost[ni];
      if (!isFinite(edge) || edge >= 1e6) continue;
      const nd = cost[cur] + edge;
      if (nd < cost[ni] && nd <= MAX_SOUND_COST) {
        cost[ni] = nd;
        push(ni);
      }
    }
  }

  const heard: HeardSound[] = [];
  for (const agent of Object.values(world.agents)) {
    if (!agent.isAlive || agent.id === sourceActorId) continue;
    const idx = agent.y * w + agent.x;
    if (!isFinite(cost[idx])) continue;
    const clarity = Math.max(0.1, 1 - cost[idx] / MAX_SOUND_COST);
    const distanceClass = cost[idx] < 10 ? 'near' : cost[idx] < 22 ? 'medium' : 'far';
    heard.push({
      sourceEventId,
      sourceActorId,
      listenerId: agent.id,
      text,
      // Direction FROM the listener TO the sound source (bearingLabel
      // computes atan2(dx, -dy) with dx/dy = source - listener).
      bearing: bearingLabel(sourceX - agent.x, sourceY - agent.y),
      distanceClass,
      clarity: Math.round(clarity * 100) / 100,
    });
  }
  return heard;
}
