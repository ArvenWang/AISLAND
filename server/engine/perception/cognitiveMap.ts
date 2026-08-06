// Per-agent cognitive map: explored/visible cells, remembered terrain,
// landmarks, route memories, position estimate and confidence (PRD 7.3, 8.4).

import { RuntimeMap } from '../map/runtimeMap';

export type LandmarkMemory = {
  kind: string; // coast, wreckage, tree, rockwall, ridge, fire, spring...
  x: number;
  y: number;
  firstSeenAt: number;
  lastSeenAt: number;
  confidence: number;
};

export type RouteMemory = {
  points: Array<{ x: number; y: number }>;
  recordedAt: number;
  familiarity: number; // 0..1, grows when retraced
};

export type TerrainMemory = {
  terrainClass: number;
  lastSeenAt: number;
  confidence: number;
};

export class CognitiveMap {
  explored = new Uint8Array(0);
  visible = new Uint8Array(0);
  rememberedTerrain = new Map<number, TerrainMemory>();
  landmarks: LandmarkMemory[] = [];
  routeMemories: RouteMemory[] = [];
  positionEstimate: { x: number; y: number };
  positionConfidence = 100;
  lastDriftAt = 0;

  constructor(private map: RuntimeMap, x: number, y: number) {
    this.explored = new Uint8Array(map.width * map.height);
    this.visible = new Uint8Array(map.width * map.height);
    this.positionEstimate = { x, y };
  }

  resetPosition(x: number, y: number) {
    this.positionEstimate = { x, y };
    this.positionConfidence = 100;
  }

  updateVision(visible: Uint8Array, gameTime: number, position: { x: number; y: number }) {
    this.visible = visible;
    for (let i = 0; i < visible.length; i++) {
      if (visible[i]) {
        this.explored[i] = 1;
        const cls = this.map.data.terrainClass[i];
        const prev = this.rememberedTerrain.get(i);
        if (!prev || prev.terrainClass !== cls) {
          this.rememberedTerrain.set(i, { terrainClass: cls, lastSeenAt: gameTime, confidence: 0.9 });
        } else {
          prev.lastSeenAt = gameTime;
          prev.confidence = Math.min(1, prev.confidence + 0.05);
        }
      }
    }
    // Position estimate follows the true position while confidence stays high;
    // drift is applied separately by orientation.ts.
    if (this.positionConfidence >= 45) {
      this.positionEstimate = { ...position };
    }
  }

  addLandmark(kind: string, x: number, y: number, gameTime: number) {
    const existing = this.landmarks.find((l) => l.kind === kind && Math.abs(l.x - x) + Math.abs(l.y - y) <= 2);
    if (existing) {
      existing.lastSeenAt = gameTime;
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      return;
    }
    this.landmarks.push({ kind, x, y, firstSeenAt: gameTime, lastSeenAt: gameTime, confidence: 0.8 });
    if (this.landmarks.length > 64) this.landmarks.shift();
  }

  recordRoute(points: Array<{ x: number; y: number }>, gameTime: number) {
    if (points.length < 3) return;
    // Merge with an existing overlapping route memory to grow familiarity.
    let merged = false;
    for (const r of this.routeMemories) {
      const overlap = r.points.filter((p) => points.some((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) <= 1)).length;
      if (overlap >= Math.min(3, points.length)) {
        r.familiarity = Math.min(1, r.familiarity + 0.15);
        r.points = points;
        r.recordedAt = gameTime;
        merged = true;
        break;
      }
    }
    if (!merged) {
      this.routeMemories.push({ points, recordedAt: gameTime, familiarity: 0.2 });
      if (this.routeMemories.length > 12) this.routeMemories.shift();
    }
  }

  familiarityNear(x: number, y: number): number {
    let best = 0;
    for (const r of this.routeMemories) {
      for (const p of r.points) {
        if (Math.abs(p.x - x) + Math.abs(p.y - y) <= 2) {
          best = Math.max(best, r.familiarity);
          break;
        }
      }
    }
    return best;
  }
}
