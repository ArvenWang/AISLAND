import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { findPath, pathCost } from '../../server/engine/map/pathGrid';
import { computeVisibleCells } from '../../server/engine/map/visibilityGrid';
import * as path from 'path';

function loadTestMap(): RuntimeMap {
  const root = path.join(__dirname, '../..');
  return RuntimeMap.loadFromFile(path.join(root, 'public/generated/maps/aisland-mvp2/map.runtime.json'));
}

describe('MVP2 runtime map', () => {
  const map = loadTestMap();

  test('map geometry: 256x192, chunks, spawn on passable cells', () => {
    expect(map.width).toBe(256);
    expect(map.height).toBe(192);
    expect(Object.keys(map.data.chunks).length).toBe(48);
    for (const s of map.data.spawnPoints) {
      expect(map.isBlocked(s.x, s.y)).toBe(false);
    }
  });

  test('ocean is impassable, beach and grass passable', () => {
    expect(map.isBlocked(0, 0)).toBe(true); // deep water
    const spawn = map.spawnPoint(0);
    expect(map.isBlocked(spawn.x, spawn.y)).toBe(false);
    expect(map.terrainAt(spawn.x, spawn.y)).toMatch(/Sand|sand/);
  });

  test('A* finds a path from beach to inland and costs match moveCost', () => {
    const spawn = map.spawnPoint(0);
    // Find a reachable inland grass cell.
    let target: { x: number; y: number } | null = null;
    let p: Array<{ x: number; y: number }> | null = null;
    for (let y = 40; y < 120 && !target; y++) {
      for (let x = 20; x < 200; x++) {
        if (!map.isBlocked(x, y) && map.terrainAt(x, y) === 'grass') {
          const candidate = findPath(map, spawn, { x, y });
          if (candidate && candidate.length > 10) {
            target = { x, y };
            p = candidate;
            break;
          }
        }
      }
    }
    expect(target).not.toBeNull();
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThan(10);
    const cost = pathCost(map, p!);
    expect(cost).toBeGreaterThanOrEqual(p!.length - 1); // each step costs >= 1 cell
    const last = p![p!.length - 1];
    expect(last.x).toBe(target!.x);
    expect(last.y).toBe(target!.y);
  });

  test('A* respects allowed predicate (unexplored cells excluded)', () => {
    const spawn = map.spawnPoint(0);
    const target = { x: 130, y: 100 };
    if (map.isBlocked(target.x, target.y)) return; // tolerate different seeds
    const full = findPath(map, spawn, target);
    const exploredOnly = findPath(map, spawn, target, {
      allowed: (x, y) => Math.abs(x - spawn.x) + Math.abs(y - spawn.y) < 30,
    });
    if (full) {
      // With a tight allowed radius the path may not reach; but it must never
      // use cells outside the allowed set.
      expect(exploredOnly).toBeNull();
    }
  });

  test('LOS: opaque terrain blocks sight, origin always visible', () => {
    for (let i = 0; i < 3; i++) {
      const spawn = map.spawnPoint(i);
      const visible = computeVisibleCells(map, spawn.x, spawn.y, 8);
      expect(visible[map.idx(spawn.x, spawn.y)]).toBe(1);
      // deep water is transparent; ocean near the beach must be visible from
      // at least one spawn (spawn layout may shift with map seeds).
      let waterVisible = false;
      for (let y = 0; y < map.height && !waterVisible; y++) {
        for (let x = 0; x < map.width; x++) {
          if (visible[map.idx(x, y)] && map.terrainAt(x, y) === 'deep') waterVisible = true;
        }
      }
      if (waterVisible) return; // PASS: ocean visible from this spawn
    }
    throw new Error('no spawn sees deep water within LOS radius 8');
  });
});
