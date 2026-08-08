import * as fs from 'node:fs';
import * as path from 'node:path';
import { PHASE3_EVIDENCE_DIR, PHASE3_OUTPUT_DIR } from './compile-phase3';

const W = 80;
const H = 52;
type Runtime = { width: number; height: number; collision: number[]; moveCost: number[]; objects: Array<{ type: string; cellX: number; cellY: number }>; spawnPoints: Array<{ x: number; y: number }>; stats: Record<string, unknown> };

function idx(x: number, y: number) { return y * W + x; }
function dijkstra(runtime: Runtime, start: { x: number; y: number }): Float64Array {
  const dist = new Float64Array(W * H).fill(Infinity);
  const visited = new Uint8Array(W * H);
  const queue: Array<{ i: number; d: number }> = [{ i: idx(start.x, start.y), d: 0 }];
  dist[queue[0].i] = 0;
  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const current = queue.shift()!;
    if (visited[current.i]) continue;
    visited[current.i] = 1;
    const x = current.i % W;
    const y = Math.floor(current.i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = idx(nx, ny);
      if (runtime.collision[ni]) continue;
      const next = current.d + runtime.moveCost[ni];
      if (next < dist[ni]) { dist[ni] = next; queue.push({ i: ni, d: next }); }
    }
  }
  return dist;
}

export function analyzePhase3Map() {
  const runtime = JSON.parse(fs.readFileSync(path.join(PHASE3_OUTPUT_DIR, 'map.runtime.json'), 'utf8')) as Runtime;
  const spawn = runtime.spawnPoints[1];
  const dist = dijkstra(runtime, spawn);
  const spring = runtime.objects.find((object) => object.type === 'water_spring');
  const springTravel = spring ? dist[idx(spring.cellX, spring.cellY)] : Infinity;
  const springHours = springTravel / 60;
  if (!Number.isFinite(springTravel) || springTravel < 60 || springTravel > 120) {
    throw new Error(`Phase3.1 known spawn-to-spring route must be 60-120 island minutes; measured ${springTravel.toFixed(0)}`);
  }
  const opposite = runtime.objects.find((object) => object.type === 'opposite_edge');
  const oppositeTravel = opposite ? dist[idx(opposite.cellX, opposite.cellY)] : Infinity;
  if (!Number.isFinite(oppositeTravel) || oppositeTravel < 180 || oppositeTravel > 260) {
    throw new Error(`Phase3.1 known spawn-to-opposite route must be 180-260 island minutes; measured ${oppositeTravel.toFixed(0)}`);
  }
  let farthest = 0;
  let farthestCell = { x: 0, y: 0 };
  for (let i = 0; i < dist.length; i++) if (Number.isFinite(dist[i]) && dist[i] > farthest) { farthest = dist[i]; farthestCell = { x: i % W, y: Math.floor(i / W) }; }
  const result = {
    size: [W, H],
    authoredTopology: runtime.stats.requiredTopology,
    spawnToSpringCost: Math.round(springTravel),
    spawnToSpringIslandHoursAt60: Number(springHours.toFixed(1)),
    spawnToOppositeCost: Math.round(oppositeTravel),
    spawnToOppositeIslandHoursAt60: Number((oppositeTravel / 60).toFixed(1)),
    spawnToFarthestCost: Math.round(farthest),
    spawnToFarthestIslandHoursAt60: Number((farthest / 60).toFixed(1)),
    farthestCell,
    objectCounts: runtime.stats.objectCounts,
    note: 'This is a geometry gate. First-unknown traversal time will be measured separately with cognitive-map replay.',
  };
  fs.mkdirSync(PHASE3_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(PHASE3_EVIDENCE_DIR, 'map-analysis.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) analyzePhase3Map();
