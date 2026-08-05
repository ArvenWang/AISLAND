import { generateIslandMap, validateMap, findPath } from '../../server/engine/map';

describe('Island map', () => {
  const { map } = generateIslandMap(101, { springInitial: 5, groveStock: 5 });

  test('is 48x48 with semantic objects', () => {
    expect(map.width).toBe(48);
    expect(map.height).toBe(48);
    expect(map.locations.length).toBeGreaterThanOrEqual(8);
    expect(map.resourceNodes.length).toBe(3);
    expect(map.spawnPoints.length).toBe(3);
    expect(map.containers.length).toBe(1);
  });

  test('validateMap returns no errors', () => {
    expect(validateMap(map)).toEqual([]);
  });

  test('Tiled JSON has terrain layer and object layer (MAP-001)', () => {
    const tiled = map.tiledJson as { layers: Array<{ name: string; type: string }> };
    expect(tiled.layers.some((l) => l.name === 'terrain' && l.type === 'tilelayer')).toBe(true);
    expect(tiled.layers.some((l) => l.name === 'objects' && l.type === 'objectgroup')).toBe(true);
  });

  test('all resource nodes reachable from camp', () => {
    const camp = map.locations.find((l) => l.id === 'crash_camp')!;
    for (const node of map.resourceNodes) {
      expect(findPath(map, camp.position, node.position)).not.toBeNull();
    }
  });

  test('deterministic across seeds differs in decoration but not structure', () => {
    const other = generateIslandMap(202, { springInitial: 5, groveStock: 5 }).map;
    expect(other.resourceNodes.map((n) => n.id)).toEqual(map.resourceNodes.map((n) => n.id));
    expect(JSON.stringify(other.objectTiles)).not.toBe(JSON.stringify(map.objectTiles));
  });
});
