// Getting-lost model (PRD 8.4, 8.5, 19.3). The server keeps the true
// position; the agent only sees positionEstimate + confidence, and local
// exploration bearing drifts as confidence drops.

import { RuntimeMap } from '../engine/map/runtimeMap';
import { CognitiveMap } from '../engine/perception/cognitiveMap';
import type { LightPhase } from '../engine/perception/lighting';

export type OrientationState = {
  positionConfidence: number;
  lastReorientAt: number;
  wrongTurnRolls: number;
};

const TERRAIN_DISORIENTATION: Record<string, number> = {
  deep: 0,
  shallow: 0,
  wetSand: 1,
  drySand: 0,
  grass: 3,
  sparse: 8,
  dense: 18,
  mud: 14,
  rock: 6,
  cliff: 10,
  path: 1,
};

export function terrainDisorientation(map: RuntimeMap, x: number, y: number): number {
  return TERRAIN_DISORIENTATION[map.terrainAt(x, y)] ?? 3;
}

export function orientationSigmaDeg(input: {
  terrain: number;
  light: LightPhase;
  fatiguePenalty: number; // 0..20
  fearPenalty: number; // 0..20
  navigationSkill: number; // 0..100
  landmarkBonus: number; // 0..24
}): number {
  const darkness = input.light === 'dusk' ? 6 : input.light === 'night' ? 20 : 0;
  return Math.max(0, Math.min(55, Math.round(
    6 + input.terrain + darkness + input.fatiguePenalty + input.fearPenalty - input.navigationSkill * 0.12 - input.landmarkBonus,
  )));
}

// Drift applied to an exploration bearing (degrees, 0 = north, clockwise).
export function driftBearing(bearingDeg: number, sigma: number, confidence: number, rng: () => number): number {
  if (confidence >= 45) return bearingDeg;
  const dev = (rng() * 2 - 1) * sigma * (1.35 - confidence / 100);
  let b = bearingDeg + dev;
  if (confidence < 25 && rng() < 0.22) {
    // Wrong turn: may pick a side path.
    b += (rng() < 0.5 ? -1 : 1) * (60 + rng() * 60);
  }
  return ((b % 360) + 360) % 360;
}

// Confidence update per island-minute.
export function updateConfidence(input: {
  map: RuntimeMap;
  cognitive: CognitiveMap;
  x: number;
  y: number;
  light: LightPhase;
  fatigue: number; // 0..1 (1 = exhausted)
  navigationSkill: number;
  deltaMinutes: number;
  reorientSignal: boolean; // landmark / coast / fire seen
  gameTime: number;
}): number {
  const c = input.cognitive;
  const terrain = terrainDisorientation(input.map, input.x, input.y);
  const darkness = input.light === 'dusk' ? 1.2 : input.light === 'night' ? 3.2 : 0;
  const fatigue = input.fatigue * 2.4;
  const familiar = c.familiarityNear(input.x, input.y) * 2;
  const base = 0.35 + terrain * 0.03 + darkness * 0.55 + fatigue * 0.9 - familiar * 0.7 - input.navigationSkill * 0.006;
  let delta = -base * input.deltaMinutes;
  if (input.reorientSignal) delta = Math.min(0, delta) + 4.5 * input.deltaMinutes;
  const next = Math.max(0, Math.min(100, c.positionConfidence + delta));
  c.positionConfidence = next;
  if (input.reorientSignal) c.lastDriftAt = input.gameTime;
  return next;
}

export function landmarkBonus(cognitive: CognitiveMap, seenLandmarkKinds: string[]): number {
  let b = 0;
  for (const k of seenLandmarkKinds) {
    if (k === 'coast' || k === 'fire' || k === 'wreckage' || k === 'viewpoint') b += 8;
    else b += 4;
  }
  return Math.min(24, b);
}
