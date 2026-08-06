// Map analysis: terrain ratios, travel-time gates, detour gate, atlas and
// texture metrics. Writes acceptance/mvp2/map/map-analysis.json.

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { MAP_W, MAP_H, TERRAIN_INDEX, type TerrainClass } from './generate-map';
import { cellIndex, type RuntimeMap } from './map-types';

export function dijkstra(map: RuntimeMap, start: { x: number; y: number }, blocked: Set<number> = new Set()): { dist: Float64Array; prev: Int32Array } {
  const n = MAP_W * MAP_H;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  // Binary min-heap of [dist, index].
  const heap: number[] = [];
  const heapPush = (d: number, i: number) => {
    let idx = heap.length;
    heap.push(i);
    const key = (k: number) => dist[heap[k]];
    while (idx > 0) {
      const p = (idx - 1) >> 1;
      if (key(p) <= key(idx)) break;
      [heap[p], heap[idx]] = [heap[idx], heap[p]];
      idx = p;
    }
  };
  const heapPop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let idx = 0;
      const key = (k: number) => dist[heap[k]];
      for (;;) {
        const l = idx * 2 + 1;
        const r = l + 1;
        let m = idx;
        if (l < heap.length && key(l) < key(m)) m = l;
        if (r < heap.length && key(r) < key(m)) m = r;
        if (m === idx) break;
        [heap[m], heap[idx]] = [heap[idx], heap[m]];
        idx = m;
      }
    }
    return top;
  };
  const s = cellIndex(start.x, start.y, MAP_W);
  dist[s] = 0;
  heapPush(0, s);
  while (heap.length > 0) {
    const u = heapPop();
    if (visited[u]) continue;
    visited[u] = 1;
    const ux = u % MAP_W;
    const uy = Math.floor(u / MAP_W);
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = ux + ox;
      const y = uy + oy;
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const v = cellIndex(x, y, MAP_W);
      if (visited[v]) continue;
      if (blocked.has(v) || map.collision[v]) continue;
      const nd = dist[u] + map.moveCost[v];
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heapPush(nd, v);
      }
    }
  }
  return { dist, prev };
}

export function analyzeMap(map: RuntimeMap): Record<string, unknown> {
  const landCells: number[] = [];
  let maxDistToBoundary = 0;
  let farthest: { x: number; y: number } | null = null;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = cellIndex(x, y, MAP_W);
      if (!map.collision[i] && map.moveCost[i] < 1e9) landCells.push(i);
    }
  }

  const spawn = map.spawnPoints[0] ?? { x: 128, y: 170 };
  const { dist } = dijkstra(map, spawn);
  for (const i of landCells) {
    if (isFinite(dist[i]) && dist[i] > maxDistToBoundary) {
      maxDistToBoundary = dist[i];
      farthest = { x: i % MAP_W, y: Math.floor(i / MAP_W) };
    }
  }

  // Detour gate: measure the detour caused by the east inlet. Compare the
  // real shortest path between a beach cell and a point north of the inlet
  // against a hypothetical path where deep water is walkable.
  // Detour gate: for the farthest land targets, block 5x5 windows along the
  // shortest path and measure the largest forced detour (mountain pass /
  // channel crossing). This is the "one obstacle forces >= 40 cell detour".
  let detourCells = 0;
  {
    const targets: Array<{ x: number; y: number }> = [];
    const sorted = landCells
      .map((i) => ({ i, d: dist[i] }))
      .filter((t) => isFinite(t.d))
      .sort((a, b) => b.d - a.d)
      .slice(0, 6);
    for (const t of sorted) targets.push({ x: t.i % MAP_W, y: Math.floor(t.i / MAP_W) });
    const { prev } = dijkstra(map, spawn);
    for (const target of targets) {
      const tIdx = cellIndex(target.x, target.y, MAP_W);
      const baseDist = dist[tIdx];
      const pathCells: number[] = [];
      let cur = tIdx;
      while (cur !== -1 && pathCells.length < 30000) {
        pathCells.push(cur);
        cur = prev[cur];
      }
      const step = Math.max(3, Math.floor(pathCells.length / 40));
      for (let k = step; k < pathCells.length - step; k += step) {
        const mid = pathCells[k];
        const midX = mid % MAP_W;
        const midY = Math.floor(mid / MAP_W);
        const blocked = new Set<number>();
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const x = midX + dx;
            const y = midY + dy;
            if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) blocked.add(cellIndex(x, y, MAP_W));
          }
        }
        const p2 = dijkstra(map, spawn, blocked);
        const d2 = p2.dist[tIdx];
        if (isFinite(d2)) detourCells = Math.max(detourCells, Math.round((d2 - baseDist) / 4));
      }
    }
  }

  // Atlas texture metrics.
  const terrainPng = PNG.sync.read(fs.readFileSync(path.join(__dirname, '../../public/generated/maps/aisland-mvp2/terrain.png')));
  const tileW = 32;
  const cols = Math.floor(terrainPng.width / tileW);
  const rows = Math.floor(terrainPng.height / tileW);
  const hashes = new Map<string, number>();
  let transparentTiles = 0;
  let magentaTiles = 0;
  const hashTile = (tx: number, ty: number): string => {
    let h = 0;
    let transparent = true;
    let magenta = false;
    for (let y = 0; y < tileW; y++) {
      for (let x = 0; x < tileW; x++) {
        const i = ((ty * tileW + y) * terrainPng.width + tx * tileW + x) * 4;
        const r = terrainPng.data[i];
        const g = terrainPng.data[i + 1];
        const b = terrainPng.data[i + 2];
        const a = terrainPng.data[i + 3];
        if (a > 0) transparent = false;
        if (r > 200 && g < 80 && b > 200 && a > 0) magenta = true;
        h = (h * 31 + r * 3 + g * 5 + b * 7 + a * 11) >>> 0;
      }
    }
    if (transparent) transparentTiles++;
    if (magenta) magentaTiles++;
    return h.toString(36);
  };
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const h = hashTile(tx, ty);
      hashes.set(h, (hashes.get(h) ?? 0) + 1);
    }
  }

  const classCounts: Record<string, number> = {};
  for (const c of map.terrainClass) {
    const name = (Object.keys(TERRAIN_INDEX) as TerrainClass[]).find((k) => TERRAIN_INDEX[k] === c) ?? '?';
    classCounts[name] = (classCounts[name] ?? 0) + 1;
  }

  // Coastline features: bays / headlands from west and east coast signatures.
  const boundary = (dir: 'west' | 'east'): number[] => {
    const out: number[] = [];
    for (let y = 0; y < MAP_H; y++) {
      let b = dir === 'west' ? -1 : MAP_W;
      for (let x = 0; x < MAP_W; x++) {
        const xx = dir === 'west' ? x : MAP_W - 1 - x;
        if (!map.collision[y * MAP_W + xx] || map.terrainClass[y * MAP_W + xx] !== 0) {
          b = xx;
          break;
        }
      }
      out.push(b);
    }
    return out;
  };
  const countFeatures = (sig: number[]): number => {
    let features = 0;
    let prevDir = 0;
    let run = 0;
    for (let y = 1; y < sig.length; y++) {
      if (sig[y] < 0 || sig[y - 1] < 0) continue;
      const d = Math.sign(sig[y] - sig[y - 1]);
      if (d === 0) continue;
      if (d !== prevDir) {
        if (run >= 4 && prevDir !== 0) features++;
        run = 1;
        prevDir = d;
      } else {
        run++;
      }
    }
    return features;
  };
  const westFeatures = countFeatures(boundary('west'));
  const eastFeatures = countFeatures(boundary('east'));

  return {
    seed: map.seed,
    size: { w: MAP_W, h: MAP_H },
    terrainRatios: classCounts,
    travelMinutesSpawnToFarthest: Math.round(maxDistToBoundary),
    travelIslandHours: (maxDistToBoundary / 60).toFixed(1),
    farthestCell: farthest,
    detourCells,
    coastlineFeatures: { west: westFeatures, east: eastFeatures, total: westFeatures + eastFeatures },
    treeCount: map.stats.treeCount,
    resourceCount: map.stats.resourceCount,
    objects: map.objects.length,
    atlas: {
      cols,
      rows,
      uniqueHashes: hashes.size,
      totalTiles: cols * rows,
      dedupRatio: (hashes.size / Math.max(1, cols * rows)).toFixed(3),
      transparentTiles,
      magentaTiles,
    },
    chunks: Object.keys(map.chunks).length,
    spawnPoints: map.spawnPoints,
    sourceHash: map.sourceHash,
  };
}

export function runAnalysis() {
  const root = path.join(__dirname, '../..');
  const runtime = JSON.parse(fs.readFileSync(path.join(root, 'public/generated/maps/aisland-mvp2/map.runtime.json'), 'utf8')) as RuntimeMap;
  const analysis = analyzeMap(runtime);
  const outDir = path.join(root, 'acceptance/mvp2/map');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'map-analysis.json'), JSON.stringify(analysis, null, 2));
  console.log(JSON.stringify(analysis, null, 1));
}

if (require.main === module) runAnalysis();
