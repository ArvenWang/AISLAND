import * as path from 'path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { findPath, pathCost } from '../../server/engine/map/pathGrid';
import { createMvp2World } from '../../server/mvp2/world';
import { sanitizeMvp2World } from '../../server/mvp2/api';
import { searchWreckage } from '../../server/mvp2/items';
import { startAction, stepWorldMovement } from '../../server/mvp2/engine';
import { computeFov, fovRadiusAt } from '../../server/engine/perception/fov';

function loadPhase3Map(): RuntimeMap {
  return RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/island-01/map.runtime.json'));
}

describe('Phase 3.1 authored small-island map', () => {
  test('runtime keeps authored geometry, terrain names and camera focus', () => {
    const map = loadPhase3Map();
    expect(map.data.version).toBe('phase31-map-v1');
    expect([map.width, map.height]).toEqual([80, 52]);
    expect(map.terrainAt(41, 30)).toBe('grass');
    expect(map.startFocus).toEqual({ x: 23, y: 46 });
    expect(map.objectsOfType('water_spring')).toHaveLength(1);
    expect(map.objectsOfType('hidden_spot')).toHaveLength(1);
    expect(map.objectsOfType('bottleneck')).toHaveLength(2);
    expect(map.objectsOfType('landmark_viewpoint')).toHaveLength(1);
    const rockIndex = map.data.terrainClass.findIndex((terrain) => terrain === 5);
    expect(rockIndex).toBeGreaterThanOrEqual(0);
    expect(map.terrainAt(rockIndex % map.width, Math.floor(rockIndex / map.width))).toBe('rock');
    expect(map.objectsOfType('wreck_main')).toHaveLength(1);
    expect(map.objectsOfType('wreck_tail').length).toBeLessThanOrEqual(1);
    expect(Object.values(map.data.chunks).flatMap((chunk) => chunk.cliffs ?? []).filter(Boolean)).toHaveLength(159);
  });

  test('known routes meet the spring and opposite-edge travel gates', () => {
    const map = loadPhase3Map();
    const spring = map.objectsOfType('water_spring')[0];
    const pathToSpring = findPath(map, map.spawnPoint(1), { x: spring.cellX, y: spring.cellY });
    expect(pathToSpring).not.toBeNull();
    expect(pathCost(map, pathToSpring!)).toBeGreaterThanOrEqual(60);
    expect(pathCost(map, pathToSpring!)).toBeLessThanOrEqual(120);
    const opposite = map.objectsOfType('opposite_edge')[0];
    const pathToOpposite = findPath(map, map.spawnPoint(1), { x: opposite.cellX, y: opposite.cellY });
    expect(pathToOpposite).not.toBeNull();
    expect(pathCost(map, pathToOpposite!)).toBeGreaterThanOrEqual(180);
    expect(pathCost(map, pathToOpposite!)).toBeLessThanOrEqual(260);
  });

  test('three survivors spawn 3-7 cells apart and can initially see each other', () => {
    const map = loadPhase3Map();
    const spawns = [map.spawnPoint(0), map.spawnPoint(1), map.spawnPoint(2)];
    for (let i = 0; i < spawns.length; i++) {
      const visible = computeFov(map, spawns[i].x, spawns[i].y, fovRadiusAt(map, spawns[i].x, spawns[i].y, { light: 'day' }));
      for (let j = i + 1; j < spawns.length; j++) {
        const distance = Math.abs(spawns[i].x - spawns[j].x) + Math.abs(spawns[i].y - spawns[j].y);
        expect(distance).toBeGreaterThanOrEqual(3);
        expect(distance).toBeLessThanOrEqual(7);
        expect(visible[spawns[j].y * map.width + spawns[j].x]).toBe(1);
      }
    }
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
    expect(opening(a).itemSpawns.water).toBe(4);
    expect(opening(a).itemSpawns.food).toBe(3);
    expect(opening(a).wrecks).toEqual([{ water: 2, food: 1 }]);
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
    const target = { x: 20, y: 47 };
    const pathToTarget = findPath(map, { x: agent.x, y: agent.y }, target);
    expect(pathToTarget).not.toBeNull();
    expect(map.moveCost(target.x, target.y)).toBe(5);
    const started = startAction(world, agent, { type: 'move', target: { kind: 'cell', ...target }, path: pathToTarget! });
    expect(started).not.toBeNull();

    stepWorldMovement(world, 2);
    expect([agent.x, agent.y]).toEqual([20, 46]);
    expect(agent.currentAction?.progress).toBeGreaterThan(0);

    stepWorldMovement(world, 3);
    expect([agent.x, agent.y]).toEqual([20, 47]);
    expect(agent.currentAction).toBeNull();
  });
});
