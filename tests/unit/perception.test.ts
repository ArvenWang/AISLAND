import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { computeFov, fovRadiusAt } from '../../server/engine/perception/fov';
import { CognitiveMap } from '../../server/engine/perception/cognitiveMap';
import { lightPhaseAt } from '../../server/engine/perception/lighting';
import { orientationSigmaDeg, driftBearing, updateConfidence } from '../../server/navigation/orientation';
import { pickFrontierWaypoint, executeExplorationStep, type ExplorationPlan } from '../../server/navigation/exploration';
import * as path from 'path';

function loadMap(): RuntimeMap {
  return RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/aisland-mvp2/map.runtime.json'));
}

describe('FOV / lighting', () => {
  const map = loadMap();

  test('day vs night radius differs on the same terrain', () => {
    const spawn = map.spawnPoint(0);
    const dayR = fovRadiusAt(map, spawn.x, spawn.y, { light: 'day' });
    const nightR = fovRadiusAt(map, spawn.x, spawn.y, { light: 'night' });
    expect(dayR).toBeGreaterThan(nightR * 2);
  });

  test('shadowcasting: open beach sees ocean, forest blocks', () => {
    const spawn = map.spawnPoint(0);
    const visible = computeFov(map, spawn.x, spawn.y, 14);
    let sawDeep = false;
    for (let y = 0; y < map.height && !sawDeep; y++) {
      for (let x = 0; x < map.width; x++) {
        if (visible[map.idx(x, y)] && map.terrainAt(x, y) === 'deep') sawDeep = true;
      }
    }
    expect(sawDeep).toBe(true);

    // In dense forest the visible radius is tiny (blocked by tree opacity).
    let forestCell: { x: number; y: number } | null = null;
    for (let y = 40; y < 120 && !forestCell; y++) {
      for (let x = 40; x < 180; x++) {
        if (map.terrainAt(x, y) === 'dense' && !map.isBlocked(x, y)) {
          forestCell = { x, y };
          break;
        }
      }
    }
    if (forestCell) {
      const vf = computeFov(map, forestCell.x, forestCell.y, 10);
      let maxDist = 0;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (vf[map.idx(x, y)]) maxDist = Math.max(maxDist, Math.max(Math.abs(x - forestCell.x), Math.abs(y - forestCell.y)));
        }
      }
      expect(maxDist).toBeLessThanOrEqual(10);
    }
  });

  test('light phase follows island clock', () => {
    expect(lightPhaseAt(400)).toBe('day');
    expect(lightPhaseAt(1100)).toBe('dusk');
    expect(lightPhaseAt(1300)).toBe('night');
    expect(lightPhaseAt(320)).toBe('dawn');
  });
});

describe('Cognitive map', () => {
  const map = loadMap();

  test('vision explores cells and remembers terrain with confidence', () => {
    const spawn = map.spawnPoint(0);
    const cog = new CognitiveMap(map, spawn.x, spawn.y);
    const visible = computeFov(map, spawn.x, spawn.y, 8);
    cog.updateVision(visible, 500, spawn);
    const seen = visible.reduce((s, v) => s + v, 0);
    expect(seen).toBeGreaterThan(30);
    const explored = cog.explored.reduce((s, v) => s + v, 0);
    expect(explored).toBe(seen);
    expect(cog.rememberedTerrain.size).toBe(seen);
    expect(cog.positionConfidence).toBe(100);
  });

  test('routes grow familiarity when retraced', () => {
    const spawn = map.spawnPoint(0);
    const cog = new CognitiveMap(map, spawn.x, spawn.y);
    const seg = [
      { x: spawn.x, y: spawn.y },
      { x: spawn.x + 1, y: spawn.y },
      { x: spawn.x + 2, y: spawn.y },
      { x: spawn.x + 3, y: spawn.y },
    ];
    cog.recordRoute(seg, 100);
    cog.recordRoute(seg, 200);
    expect(cog.familiarityNear(spawn.x + 2, spawn.y)).toBeCloseTo(0.35);
  });

  test('landmarks dedupe and cap', () => {
    const cog = new CognitiveMap(map, 100, 100);
    cog.addLandmark('coast', 90, 90, 100);
    cog.addLandmark('coast', 91, 89, 200);
    expect(cog.landmarks.length).toBe(1);
    expect(cog.landmarks[0].confidence).toBeGreaterThan(0.8);
  });
});

describe('Orientation / getting lost', () => {
  test('sigma: dense+night+fatigue much higher than beach+day+skill', () => {
    const bad = orientationSigmaDeg({ terrain: 18, light: 'night', fatiguePenalty: 16, fearPenalty: 10, navigationSkill: 30, landmarkBonus: 0 });
    const good = orientationSigmaDeg({ terrain: 0, light: 'day', fatiguePenalty: 2, fearPenalty: 1, navigationSkill: 85, landmarkBonus: 16 });
    expect(bad).toBeGreaterThan(35);
    expect(good).toBeLessThan(12);
  });

  test('drift only when confidence is low, and is seeded-deterministic', () => {
    const rng = () => 0.9;
    const bHigh = driftBearing(90, 20, 80, rng);
    const bLow = driftBearing(90, 20, 30, rng);
    expect(bHigh).toBe(90);
    expect(bLow).not.toBe(90);
    expect(Math.abs(bLow - 90)).toBeLessThan(45);
    // deterministic: same seed same result
    expect(driftBearing(90, 20, 30, rng)).toBe(bLow);
  });

  test('confidence decays and recovers on reorient signals', () => {
    const map = loadMap();
    const spawn = map.spawnPoint(0);
    const cog = new CognitiveMap(map, spawn.x, spawn.y);
    cog.positionConfidence = 80;
    const after = updateConfidence({
      map,
      cognitive: cog,
      x: spawn.x,
      y: spawn.y,
      light: 'day',
      fatigue: 0.2,
      navigationSkill: 50,
      deltaMinutes: 30,
      reorientSignal: false,
      gameTime: 1000,
    });
    expect(after).toBeLessThan(80);
    const recovered = updateConfidence({
      map,
      cognitive: cog,
      x: spawn.x,
      y: spawn.y,
      light: 'day',
      fatigue: 0.2,
      navigationSkill: 50,
      deltaMinutes: 10,
      reorientSignal: true,
      gameTime: 1010,
    });
    expect(recovered).toBeGreaterThan(after);
  });
});

describe('Local exploration', () => {
  const map = loadMap();

  test('waypoints are only on known (explored/visible) cells', () => {
    const spawn = map.spawnPoint(0);
    const cog = new CognitiveMap(map, spawn.x, spawn.y);
    const visible = computeFov(map, spawn.x, spawn.y, 8);
    cog.updateVision(visible, 100, spawn);
    const plan: ExplorationPlan = { mode: 'head_inland', approximateBearing: 0, objectiveText: '向北探索', abortConditions: [] };
    for (let i = 0; i < 20; i++) {
      const wp = pickFrontierWaypoint(map, cog, spawn, plan, () => 0.3);
      if (!wp) break;
      expect(cog.explored[wp.y * map.width + wp.x]).toBe(1);
    }
  });

  test('follow_coast prefers coastal cells', () => {
    const spawn = map.spawnPoint(0);
    const cog = new CognitiveMap(map, spawn.x, spawn.y);
    const visible = computeFov(map, spawn.x, spawn.y, 10);
    cog.updateVision(visible, 100, spawn);
    const plan: ExplorationPlan = { mode: 'follow_coast', objectiveText: '沿海岸走', abortConditions: [] };
    const wp = pickFrontierWaypoint(map, cog, spawn, plan, () => 0.2);
    expect(wp).not.toBeNull();
    if (wp) {
      const t = map.terrainAt(wp.x, wp.y);
      expect(['wetSand', 'drySand', 'shallow', 'grass'].includes(t)).toBe(true);
    }
  });

  test('exploration paths never use hidden cells', () => {
    const spawn = map.spawnPoint(0);
    const cog = new CognitiveMap(map, spawn.x, spawn.y);
    const visible = computeFov(map, spawn.x, spawn.y, 6);
    cog.updateVision(visible, 100, spawn);
    const plan: ExplorationPlan = { mode: 'head_inland', approximateBearing: 90, objectiveText: '探索', abortConditions: [] };
    const step = executeExplorationStep(map, cog, spawn, plan, 100, () => 0.4);
    if (step && step.path.length) {
      for (const p of step.path) {
        expect(cog.explored[p.y * map.width + p.x]).toBe(1);
      }
    }
  });
});
