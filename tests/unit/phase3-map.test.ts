import * as path from 'path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { findPath, pathCost } from '../../server/engine/map/pathGrid';
import { createMvp2World } from '../../server/mvp2/world';
import { sanitizeMvp2World } from '../../server/mvp2/api';
import { searchWreckage } from '../../server/mvp2/items';
import { startAction, stepWorldMovement } from '../../server/mvp2/engine';

function loadPhase3Map(): RuntimeMap {
  return RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/island-01/map.runtime.json'));
}

describe('Phase 3 authored map', () => {
  test('runtime keeps authored geometry, terrain names and camera focus', () => {
    const map = loadPhase3Map();
    expect(map.data.version).toBe('phase3-map-v2');
    expect([map.width, map.height]).toEqual([144, 112]);
    expect(map.terrainAt(68, 55)).toBe('grass');
    expect(map.startFocus).toEqual({ x: 48, y: 97 });
    expect(map.objectsOfType('water_spring')).toHaveLength(1);
    expect(map.objectsOfType('hidden_spot')).toHaveLength(2);
    expect(map.objectsOfType('bottleneck')).toHaveLength(2);
    expect(map.objectsOfType('landmark_viewpoint')).toHaveLength(1);
    const rockIndex = map.data.terrainClass.findIndex((terrain) => terrain === 5);
    expect(rockIndex).toBeGreaterThanOrEqual(0);
    expect(map.terrainAt(rockIndex % map.width, Math.floor(rockIndex / map.width))).toBe('rock');
    expect(Object.values(map.data.chunks).flatMap((chunk) => chunk.cliffs ?? []).filter(Boolean)).toHaveLength(289);
  });

  test('authored spring route stays inside the 7-9 island-hour gate', () => {
    const map = loadPhase3Map();
    const spring = map.objectsOfType('water_spring')[0];
    const pathToSpring = findPath(map, map.spawnPoint(1), { x: spring.cellX, y: spring.cellY });
    expect(pathToSpring).not.toBeNull();
    expect(pathCost(map, pathToSpring!)).toBeGreaterThanOrEqual(420);
    expect(pathCost(map, pathToSpring!)).toBeLessThanOrEqual(540);
  });

  test('opening carried and wreck inventory is authored, not seed-randomized', () => {
    const map = loadPhase3Map();
    const a = createMvp2World('phase3-a', 1, map);
    const b = createMvp2World('phase3-b', 999999, map);
    const opening = (world: ReturnType<typeof createMvp2World>) => ({
      itemSpawns: Object.values(world.groundItems).reduce<Record<string, number>>((out, item) => {
        out[item.kind] = (out[item.kind] ?? 0) + item.quantity;
        return out;
      }, {}),
      wrecks: Object.values(world.wrecks).map((wreck) => wreck.contents),
    });
    expect(opening(a)).toEqual(opening(b));
    expect(opening(a).itemSpawns.water).toBe(3);
    expect(opening(a).itemSpawns.food).toBe(2);
    expect(opening(a).wrecks).toEqual([{ water: 2, food: 1 }, { water: 1, food: 1 }]);
  });

  test('searched wreck state reaches the client visual contract', () => {
    const map = loadPhase3Map();
    const world = createMvp2World('phase3-wreck-state', 7, map);
    expect(sanitizeMvp2World(world).wrecks[0]).toMatchObject({ wreckId: 'wreck_1', searched: false });
    searchWreckage(world, world.agents.agent_a, 'wreck_1');
    expect(sanitizeMvp2World(world).wrecks[0]).toMatchObject({ wreckId: 'wreck_1', searched: true });
  });

  test('movement accumulates sub-cell minutes across 5-minute live ticks', () => {
    const map = loadPhase3Map();
    const world = createMvp2World('phase3-live-movement', 11, map);
    const agent = world.agents.agent_a;
    const target = { x: 42, y: 96 };
    const pathToTarget = findPath(map, { x: agent.x, y: agent.y }, target);
    expect(pathToTarget).not.toBeNull();
    expect(map.moveCost(target.x, target.y)).toBeGreaterThan(5);
    const started = startAction(world, agent, { type: 'move', target: { kind: 'cell', ...target }, path: pathToTarget! });
    expect(started).not.toBeNull();

    stepWorldMovement(world, 5);
    expect([agent.x, agent.y]).toEqual([43, 96]);
    expect(agent.currentAction?.progress).toBeGreaterThan(0);

    stepWorldMovement(world, 5);
    expect([agent.x, agent.y]).toEqual([42, 96]);
    expect(agent.currentAction).toBeNull();
  });
});
