// Local exploration: agents choose direction/features; the server picks
// waypoints only from visible/explored cells and pathfinds only on known
// cells (PRD 8.2, 8.3, 19.1: unknown exploration never uses hidden cells).

import { RuntimeMap } from '../engine/map/runtimeMap';
import { CognitiveMap } from '../engine/perception/cognitiveMap';
import { findPath } from '../engine/map/pathGrid';
import { driftBearing } from './orientation';

export type ExplorationMode = 'follow_coast' | 'head_inland' | 'follow_slope' | 'follow_sound' | 'search_local' | 'return_to_landmark';

export type ExplorationPlan = {
  mode: ExplorationMode;
  approximateBearing?: number; // degrees, 0 = north, clockwise
  feature?: string;
  objectiveText: string;
  returnByGameTime?: number;
  abortConditions: string[];
  seekWater?: boolean;
};

export type ExplorationStep = {
  waypoint: { x: number; y: number };
  path: Array<{ x: number; y: number }>;
  bearingDeg: number;
  confidence: number;
  aborted: boolean;
  abortReason?: string;
};

const LOOKAHEAD = 9;

function cellScore(map: RuntimeMap, cognitive: CognitiveMap, x: number, y: number, agent: { x: number; y: number }, plan: ExplorationPlan): number {
  const i = y * map.width + x;
  if (!cognitive.explored[i] && !cognitive.visible[i]) return -Infinity;
  if (map.isBlocked(x, y)) return -Infinity;
  const terrain = map.terrainAt(x, y);
  const dx = x - agent.x;
  const dy = y - agent.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2 || dist > LOOKAHEAD) return -Infinity;

  let score = 10 - dist;
  // Bearing alignment (if given).
  if (plan.approximateBearing !== undefined) {
    const bearingRad = (plan.approximateBearing * Math.PI) / 180;
    const target = Math.atan2(dx, -dy); // 0 = north
    let diff = Math.abs(target - bearingRad);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    score += Math.cos(diff) * 8;
  }
  // Mode preferences.
  if (plan.mode === 'follow_coast') {
    const coastal = terrain === 'wetSand' || terrain === 'drySand' || terrain === 'shallow';
    score += coastal ? 6 : -3;
    // prefer cells adjacent to water (the coastline itself)
    let nearWater = false;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = map.terrainAt(x + ox, y + oy);
      if (t === 'deep' || t === 'shallow' || t === 'wetSand') nearWater = true;
    }
    if (nearWater) score += 4;
  } else if (plan.mode === 'head_inland') {
    score += terrain === 'grass' || terrain === 'sparse' || terrain === 'dense' ? 4 : 0;
    score -= terrain === 'wetSand' || terrain === 'drySand' ? 4 : 0;
  } else if (plan.mode === 'follow_slope') {
    score += terrain === 'rock' || terrain === 'cliff' || terrain === 'grass' ? 3 : 0;
  } else if (plan.mode === 'search_local') {
    score += cognitive.rememberedTerrain.has(i) ? -2 : 2; // prefer unseen-but-known cells
  } else if (plan.mode === 'return_to_landmark' && plan.feature) {
    // handled by caller via explicit target; score by distance to target
  }
  if (plan.seekWater) {
    if (terrain === 'mud' || terrain === 'grass') score += 4;
    if (terrain === 'wetSand' || terrain === 'drySand') score += 1.5;
    if (terrain === 'dense' || terrain === 'rock' || terrain === 'cliff') score -= 3;
  }
  // Novelty: prefer frontier (visible but not long-explored).
  const mem = cognitive.rememberedTerrain.get(i);
  if (mem && mem.confidence > 0.9) score -= 1.5;
  return score;
}

export function pickFrontierWaypoint(
  map: RuntimeMap,
  cognitive: CognitiveMap,
  agent: { x: number; y: number },
  plan: ExplorationPlan,
  rng: () => number,
): { x: number; y: number } | null {
  if (plan.mode === 'return_to_landmark' && plan.feature) {
    const lm = cognitive.landmarks.find((l) => l.kind === plan.feature);
    if (lm) return { x: lm.x, y: lm.y };
  }
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  const r = Math.max(2, Math.min(LOOKAHEAD, Math.floor(cognitive.positionConfidence / 12)));
  for (let y = agent.y - r; y <= agent.y + r; y++) {
    for (let x = agent.x - r; x <= agent.x + r; x++) {
      if (!map.inBounds(x, y)) continue;
      const s = cellScore(map, cognitive, x, y, agent, plan);
      if (s === -Infinity) continue;
      candidates.push({ x, y, score: s + rng() * 0.8 });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

export function executeExplorationStep(
  map: RuntimeMap,
  cognitive: CognitiveMap,
  agent: { x: number; y: number },
  plan: ExplorationPlan,
  gameTime: number,
  rng: () => number,
): ExplorationStep | null {
  // Abort conditions evaluated by the caller (they depend on agent state);
  // here we handle the spatial ones.
  const sigma = 8; // caller computes real sigma; drift applied to bearing
  const bearing = driftBearing(plan.approximateBearing ?? 90, sigma, cognitive.positionConfidence, rng);
  const wp = pickFrontierWaypoint(map, cognitive, agent, { ...plan, approximateBearing: bearing }, rng);
  if (!wp) {
    return { waypoint: { ...agent }, path: [], bearingDeg: bearing, confidence: cognitive.positionConfidence, aborted: true, abortReason: 'no_known_frontier' };
  }
  const path = findPath(map, agent, wp, {
    allowed: (x, y) => cognitive.explored[y * map.width + x] === 1 || cognitive.visible[y * map.width + x] === 1,
  });
  if (!path || path.length < 2) {
    return { waypoint: wp, path: [], bearingDeg: bearing, confidence: cognitive.positionConfidence, aborted: true, abortReason: 'no_path' };
  }
  cognitive.recordRoute(path.slice(0, 6), gameTime);
  return { waypoint: wp, path, bearingDeg: bearing, confidence: cognitive.positionConfidence, aborted: false };
}
