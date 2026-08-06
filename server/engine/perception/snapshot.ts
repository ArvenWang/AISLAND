// PerceptionSnapshot builder: the only world view an agent gets (PRD 19.2).
// No map dimensions, no global coordinates, no unexplored resource ids.

import { RuntimeMap } from '../map/runtimeMap';
import { CognitiveMap } from './cognitiveMap';

export type PerceivedAgent = {
  id: string;
  name: string | null; // null until introduced
  x: number;
  y: number;
  activity: string;
};

export type PerceivedItem = {
  id: string;
  kind: string;
  x: number;
  y: number;
  quantity: number;
};

export type HeardSound = {
  bearing: string;
  distanceClass: 'near' | 'medium' | 'far';
  clarity: number;
  text: string;
  sourceKnown: boolean;
  sourceEventId: string;
};

export type PerceptionSnapshot = {
  gameTime: number;
  terrainSummary: Array<{ terrain: string; count: number; nearby: boolean }>;
  visibleAgents: PerceivedAgent[];
  visibleItems: PerceivedItem[];
  visibleLandmarks: string[];
  audibleEvents: HeardSound[];
  lightLevel: string;
  positionConfidence: number;
  positionHint: string;
};

const TERRAIN_LABEL: Record<number, string> = {
  0: '海水',
  1: '浅水',
  2: '湿沙',
  3: '干沙',
  4: '草地',
  5: '稀疏林地',
  6: '密林',
  7: '湿地/泥地',
  8: '岩地',
  9: '悬崖',
  10: '踩踏小径',
};

export function buildPerceptionSnapshot(
  map: RuntimeMap,
  agentId: string,
  agents: Array<{ id: string; name: string | null; x: number; y: number; activity: string }>,
  items: Array<{ id: string; kind: string; x: number; y: number; quantity: number }>,
  sounds: HeardSound[],
  cognitive: CognitiveMap,
  lightLevel: string,
  gameTime: number,
): PerceptionSnapshot {
  const counts = new Map<number, number>();
  const nearby = new Map<number, boolean>();
  for (let i = 0; i < cognitive.visible.length; i++) {
    if (!cognitive.visible[i]) continue;
    const cls = map.data.terrainClass[i];
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    const d = Math.abs(x - cognitive.positionEstimate.x) + Math.abs(y - cognitive.positionEstimate.y);
    if (d <= 4) nearby.set(cls, true);
  }
  const terrainSummary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([cls, count]) => ({ terrain: TERRAIN_LABEL[cls] ?? `地形${cls}`, count, nearby: nearby.get(cls) ?? false }));

  const visibleAgents: PerceivedAgent[] = agents
    .filter((a) => a.id !== agentId && cognitive.visible[a.y * map.width + a.x])
    .map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y, activity: a.activity }));

  const visibleItems: PerceivedItem[] = items.filter((it) => cognitive.visible[it.y * map.width + it.x]);

  const visibleLandmarks = cognitive.landmarks.filter((l) => cognitive.visible[l.y * map.width + l.x]).map((l) => l.kind);

  const confidence = cognitive.positionConfidence;
  const positionHint =
    confidence >= 70
      ? '我能比较确定自己在哪里。'
      : confidence >= 40
        ? '我对当前位置只有大概把握。'
        : confidence >= 20
          ? '我有点分不清方向了。'
          : '我迷路了。';

  return {
    gameTime,
    terrainSummary,
    visibleAgents,
    visibleItems,
    visibleLandmarks,
    audibleEvents: sounds.slice(0, 6),
    lightLevel,
    positionConfidence: confidence,
    positionHint,
  };
}
