// Island map generation: 48x48, deterministic from seed, Tiled-style semantic
// object layers (PRD 6.1, MAP-001).

import { Rng, hashString } from './rng';
import type { IslandMap, ResourceNode, TerrainKind, Vec2 } from './types';

export const MAP_VERSION = 'island-map-v0.1';
export const TILE_DIM = 32;

const TILESET_URL = '/assets/rpg-tileset.png';
const TILESET_DIM_X = 1600;
const TILESET_DIM_Y = 1600;

// Tile indices into rpg-tileset.png (50 columns).
const T = {
  water: [838, 835, 785, 788],
  shallow: [56, 58, 59, 151],
  sand: [273, 274, 275, 280, 281],
  grass: [501, 502, 503, 504, 51, 53],
  dirt: [26, 27, 28, 126, 127, 128],
  rock: [376, 377, 913, 914],
  cliff: [913, 914, 424, 426],
};

const GENTLE_CANOPY = [316, 317, 318, 352, 353, 354];

export type MapObjects = {
  locations: IslandMap['locations'];
  resourceNodes: ResourceNode[];
  spawnPoints: Vec2[];
  campContainers: Array<{ id: string; kind: 'camp_crate'; position: Vec2 }>;
};

export function generateIslandMap(seed: number, scenarioInit: { springInitial: number; groveStock: number }): { map: IslandMap; objects: MapObjects } {
  const rng = new Rng(seed ^ hashString('island-map'));
  const W = 48;
  const H = 48;

  const terrain: TerrainKind[][] = Array.from({ length: H }, () => Array<TerrainKind>(W).fill('water'));
  const tile: number[][] = Array.from({ length: H }, () => Array<number>(W).fill(T.water[0]));

  const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  // Landmass: grass core, sand ring, shallow ring.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inEllipse(x, y, 23.5, 23.5, 13.2, 12.8)) {
        terrain[y][x] = 'grass';
      } else if (inEllipse(x, y, 23.5, 23.5, 15.2, 14.8)) {
        terrain[y][x] = 'sand';
      } else if (inEllipse(x, y, 23.5, 23.5, 17.0, 16.6)) {
        terrain[y][x] = 'shallow';
      }
    }
  }

  // NW highland ridge: rock mass with two narrow passages (one west, one south).
  const ridge = (x: number, y: number) => {
    return (
      x >= 7 && x <= 17 && y >= 5 && y <= 16 &&
      !(x >= 14 && y >= 13) && // south-east gap (passage 1)
      !(x <= 9 && y >= 12) // south-west gap (passage 2)
    );
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (terrain[y][x] === 'grass' && ridge(x, y)) {
        terrain[y][x] = 'rock';
      }
    }
  }

  // Camp clearing (center-west).
  for (let y = 20; y <= 28; y++) {
    for (let x = 17; x <= 25; x++) {
      if (terrain[y][x] === 'grass' || terrain[y][x] === 'sand') terrain[y][x] = 'dirt';
    }
  }

  // Dirt paths: camp -> spring (NE), camp -> grove (SE), camp -> tide pool (SW), camp -> ridge.
  const pathTo = (from: Vec2, to: Vec2) => {
    let { x, y } = from;
    let guard = 0;
    while ((x !== to.x || y !== to.y) && guard++ < 80) {
      if (terrain[y]?.[x] === 'grass' || terrain[y]?.[x] === 'sand' || terrain[y]?.[x] === 'shallow') terrain[y][x] = 'dirt';
      const dx = to.x - x;
      const dy = to.y - y;
      if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx);
      else y += Math.sign(dy);
    }
  };

  // Fix node positions onto passable tiles (spiral search), then connect them.
  const fixPassable = (pos: Vec2): Vec2 => {
    if (terrain[pos.y]?.[pos.x] === 'grass' || terrain[pos.y]?.[pos.x] === 'sand' || terrain[pos.y]?.[pos.x] === 'dirt') return pos;
    for (let r = 1; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = pos.x + dx;
          const y = pos.y + dy;
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          if (terrain[y][x] === 'grass' || terrain[y][x] === 'sand' || terrain[y][x] === 'dirt') {
            return { x, y };
          }
        }
      }
    }
    return pos;
  };
  const springPos = fixPassable({ x: 35, y: 11 });
  const grovePos = fixPassable({ x: 38, y: 33 });
  const tidePos = fixPassable({ x: 10, y: 34 });

  // Pool tiles around the spring / tide nodes (nodes themselves stay passable).
  for (const [sx, sy] of [[springPos.x + 1, springPos.y], [springPos.x + 1, springPos.y + 1], [springPos.x, springPos.y + 1], [springPos.x + 2, springPos.y]]) {
    terrain[sy][sx] = 'shallow';
  }
  for (const [sx, sy] of [[tidePos.x + 1, tidePos.y], [tidePos.x + 1, tidePos.y + 1], [tidePos.x, tidePos.y + 1], [tidePos.x + 2, tidePos.y]]) {
    terrain[sy][sx] = 'shallow';
  }
  terrain[springPos.y][springPos.x] = 'dirt';
  terrain[grovePos.y][grovePos.x] = 'dirt';
  terrain[tidePos.y][tidePos.x] = 'dirt';
  pathTo({ x: 21, y: 24 }, springPos);
  pathTo({ x: 21, y: 24 }, grovePos);
  pathTo({ x: 21, y: 24 }, tidePos);
  pathTo({ x: 20, y: 22 }, { x: 14, y: 17 });

  // Terrain texture tiles with slight deterministic variation.
  const pick = (arr: number[]) => arr[rng.int(0, arr.length)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = terrain[y][x];
      tile[y][x] = pick(T[k]);
    }
  }

  // Decorative object tiles: canopy at grove + scattered trees on grass.
  const objectTiles: Array<{ x: number; y: number; sheet: 'rpg' | 'gentle'; tileIndex: number }> = [];
  const groveTiles: Array<[number, number]> = [
    [grovePos.x + 1, grovePos.y - 1],
    [grovePos.x + 2, grovePos.y],
    [grovePos.x - 1, grovePos.y + 1],
    [grovePos.x + 1, grovePos.y + 1],
    [grovePos.x - 2, grovePos.y],
    [grovePos.x, grovePos.y + 1],
    [grovePos.x + 2, grovePos.y + 1],
  ];
  for (const [gx, gy] of groveTiles) {
    if (terrain[gy]?.[gx] === 'grass' || terrain[gy]?.[gx] === 'dirt') {
      objectTiles.push({ x: gx, y: gy, sheet: 'gentle', tileIndex: GENTLE_CANOPY[rng.int(0, GENTLE_CANOPY.length)] });
    }
  }
  // Scattered trees on grass (avoid paths).
  let trees = 0;
  while (trees < 26) {
    const x = rng.int(2, W - 2);
    const y = rng.int(2, H - 2);
    if (terrain[y][x] === 'grass' && !ridge(x, y) && !(x >= 16 && x <= 26 && y >= 19 && y <= 29)) {
      objectTiles.push({ x, y, sheet: 'gentle', tileIndex: GENTLE_CANOPY[rng.int(0, GENTLE_CANOPY.length)] });
      trees++;
    }
  }

  // Passability & move cost.
  const passable: boolean[][] = Array.from({ length: H }, () => Array<boolean>(W).fill(false));
  const moveCost: number[][] = Array.from({ length: H }, () => Array<number>(W).fill(1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = terrain[y][x];
      passable[y][x] = k === 'grass' || k === 'sand' || k === 'dirt' || k === 'rock';
      moveCost[y][x] = k === 'rock' ? 2.0 : k === 'sand' ? 1.1 : k === 'dirt' ? 0.9 : 1.0;
    }
  }

  // Semantic locations & nodes.
  const locations: IslandMap['locations'] = [
    {
      id: 'crash_camp',
      name: '坠机营地',
      kind: 'camp',
      position: { x: 21, y: 24 },
      radius: 3,
      description: '坠机点与公共储物箱所在地，主要会面点。',
    },
    {
      id: 'water_spring_01',
      name: '淡水泉',
      kind: 'node',
      position: { ...springPos },
      radius: 2,
      description: '岛上唯一稳定淡水来源，位于东北，路程较远。',
    },
    {
      id: 'coconut_grove_01',
      name: '椰林',
      kind: 'node',
      position: { ...grovePos },
      radius: 2,
      description: '有限食物节点，位于东南，植物研究员采集效率更高。',
    },
    {
      id: 'tide_pool_01',
      name: '潮池',
      kind: 'node',
      position: { ...tidePos },
      radius: 2,
      description: '每日少量可再生食物，位于西南并有时间窗口。',
    },
    {
      id: 'highland_ridge',
      name: '高地观察点',
      kind: 'ridge',
      position: { x: 13, y: 9 },
      radius: 3,
      description: '不直接产资源，但能扩大探索范围。',
    },
    {
      id: 'north_ridge_zone',
      name: '北部山脊',
      kind: 'zone',
      position: { x: 28, y: 12 },
      radius: 4,
      description: '通往东北淡水泉的必经高地，能俯瞰北部地形。',
    },
    {
      id: 'east_coast_zone',
      name: '东部海岸',
      kind: 'zone',
      position: { x: 39, y: 28 },
      radius: 4,
      description: '通往东南椰林的海岸地带。',
    },
    {
      id: 'south_zone',
      name: '南部滩涂',
      kind: 'zone',
      position: { x: 18, y: 36 },
      radius: 4,
      description: '通往西南潮池的南部滩涂。',
    },
    {
      id: 'west_zone',
      name: '西部礁岸',
      kind: 'zone',
      position: { x: 6, y: 27 },
      radius: 4,
      description: '岛屿西侧的礁石海岸。',
    },
  ];

  const resourceNodes: ResourceNode[] = [
    {
      id: 'water_spring_01',
      kind: 'spring',
      resource: 'water',
      position: { ...springPos },
      stock: scenarioInit.springInitial,
      capacity: 5,
      regenRule: 'restore_to_capacity_daily',
      regenAmount: 5,
      harvestDurationMinutes: 30,
      interactionRadius: 2,
      failureChance: 0,
      discoveredBy: [],
      harvestHistory: [],
    },
    {
      id: 'coconut_grove_01',
      kind: 'grove',
      resource: 'food',
      position: { ...grovePos },
      stock: scenarioInit.groveStock,
      capacity: 5,
      regenRule: 'none',
      harvestDurationMinutes: 45,
      interactionRadius: 2,
      failureChance: 0,
      discoveredBy: [],
      harvestHistory: [],
    },
    {
      id: 'tide_pool_01',
      kind: 'tide_pool',
      resource: 'food',
      position: { ...tidePos },
      stock: 2,
      capacity: 2,
      regenRule: 'restore_to_capacity_daily',
      regenAmount: 2,
      harvestDurationMinutes: 40,
      interactionRadius: 2,
      failureChance: 0.15,
      discoveredBy: [],
      harvestHistory: [],
    },
  ];

  const spawnPoints: Vec2[] = [
    { x: 19, y: 24 },
    { x: 22, y: 23 },
    { x: 21, y: 26 },
  ];

  const campContainers: Array<{ id: string; kind: 'camp_crate'; position: Vec2 }> = [
    { id: 'camp_crate', kind: 'camp_crate', position: { x: 20, y: 24 } },
  ];

  // Discovery zones: tiles within radius of each node / special location.
  const discoveryZones = locations.map((loc) => ({
    id: loc.id,
    position: loc.position,
    radius: loc.kind === 'camp' ? 4 : loc.kind === 'node' ? 3 : 4,
  }));

  const map: IslandMap = {
    width: W,
    height: H,
    tileDim: TILE_DIM,
    tilesetUrl: TILESET_URL,
    tilesetDimX: TILESET_DIM_X,
    tilesetDimY: TILESET_DIM_Y,
    terrain,
    terrainTile: tile,
    objectTiles,
    locations,
    resourceNodes,
    containers: campContainers,
    spawnPoints,
    interactionZones: discoveryZones,
    passable,
    moveCost,
    tiledJson: buildTiledJson(terrain, tile, locations, resourceNodes, spawnPoints, campContainers, discoveryZones),
  };

  return { map, objects: { locations, resourceNodes, spawnPoints, campContainers } };
}

// Tiled-compatible JSON export (MAP-001: semantic object layers).
function buildTiledJson(
  terrain: TerrainKind[][],
  tile: number[][],
  locations: IslandMap['locations'],
  resourceNodes: ResourceNode[],
  spawnPoints: Vec2[],
  containers: Array<{ id: string; kind: 'camp_crate'; position: Vec2 }>,
  discoveryZones: Array<{ id: string; position: Vec2; radius: number }>,
): unknown {
  const csv = tile
    .map((row) => row.map((t) => t + 1).join(','))
    .join('\n');
  const obj = (id: string, kind: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: kind,
    x: x * TILE_DIM,
    y: y * TILE_DIM,
    width: TILE_DIM,
    height: TILE_DIM,
    properties: extra,
  });
  const objects = [
    ...spawnPoints.map((p, i) => obj(`spawn_${i}`, 'spawn', p.x, p.y, { agentIndex: i })),
    ...containers.map((c) => obj(c.id, 'container', c.position.x, c.position.y, { kind: c.kind })),
    ...locations.map((l) => obj(l.id, 'location', l.position.x, l.position.y, { name: l.name, kind: l.kind, radius: l.radius })),
    ...resourceNodes.map((n) =>
      obj(n.id, 'resourceNode', n.position.x, n.position.y, {
        resource: n.resource,
        capacity: n.capacity,
        regenRule: n.regenRule,
        harvestDurationMinutes: n.harvestDurationMinutes,
      }),
    ),
    ...discoveryZones.map((z) => obj(`discovery_${z.id}`, 'discoveryZone', z.position.x, z.position.y, { radius: z.radius, targetId: z.id })),
  ];
  return {
    type: 'map',
    version: '1.10',
    width: terrain[0].length,
    height: terrain.length,
    tilewidth: TILE_DIM,
    tileheight: TILE_DIM,
    infinite: false,
    tilesets: [
      { firstgid: 1, source: 'rpg-tileset.tsx', image: 'rpg-tileset.png', imagewidth: TILESET_DIM_X, imageheight: TILESET_DIM_Y, tilewidth: TILE_DIM, tileheight: TILE_DIM, columns: 50 },
    ],
    layers: [
      { id: 1, name: 'terrain', type: 'tilelayer', width: terrain[0].length, height: terrain.length, data: csv },
      { id: 2, name: 'objects', type: 'objectgroup', objects },
    ],
  };
}

export function validateMap(map: IslandMap): string[] {
  const errors: string[] = [];
  if (map.width !== 48 || map.height !== 48) errors.push('map must be 48x48');
  if (map.locations.length < 5) errors.push('missing semantic locations');
  if (map.resourceNodes.length < 3) errors.push('missing resource nodes');
  const water = map.resourceNodes.find((n) => n.id === 'water_spring_01');
  if (!water) errors.push('missing water spring');
  const foodNodes = map.resourceNodes.filter((n) => n.resource === 'food');
  if (foodNodes.length < 2) errors.push('need at least two food sources');
  if (map.spawnPoints.length !== 3) errors.push('need 3 spawn points');
  // Ensure all nodes reachable from camp.
  const camp = map.locations.find((l) => l.id === 'crash_camp');
  if (camp) {
    for (const node of map.resourceNodes) {
      if (!pathExists(map, camp.position, node.position)) errors.push(`unreachable node ${node.id}`);
    }
  }
  return errors;
}

function pathExists(map: IslandMap, from: Vec2, to: Vec2): boolean {
  const seen = new Set<string>();
  const q: Vec2[] = [from];
  seen.add(`${from.x},${from.y}`);
  while (q.length) {
    const cur = q.shift()!;
    if (Math.abs(cur.x - to.x) <= 1 && Math.abs(cur.y - to.y) <= 1 && map.passable[to.y]?.[to.x]) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && map.passable[ny][nx] && !seen.has(key)) {
        seen.add(key);
        q.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

export function findPath(map: IslandMap, from: Vec2, to: Vec2): Vec2[] | null {
  if (!map.passable[from.y]?.[from.x] || !map.passable[to.y]?.[to.x]) return null;
  // A* with moveCost.
  const key = (v: Vec2) => `${v.x},${v.y}`;
  const start = key(from);
  const goal = key(to);
  const g: Record<string, number> = { [start]: 0 };
  const came: Record<string, Vec2> = {};
  const open: Array<{ v: Vec2; f: number }> = [{ v: from, f: 0 }];
  const closed = new Set<string>();
  const h = (v: Vec2) => Math.abs(v.x - to.x) + Math.abs(v.y - to.y);
  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;
    const ck = key(cur.v);
    if (ck === goal) {
      const path: Vec2[] = [];
      let c: Vec2 = cur.v;
      while (c) {
        path.push(c);
        c = came[key(c)] as Vec2;
      }
      return path.reverse();
    }
    if (closed.has(ck)) continue;
    closed.add(ck);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.v.x + dx;
      const ny = cur.v.y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || !map.passable[ny][nx]) continue;
      const nv: Vec2 = { x: nx, y: ny };
      const nk = key(nv);
      if (closed.has(nk)) continue;
      const cost = g[ck] + map.moveCost[ny][nx];
      if (g[nk] === undefined || cost < g[nk]) {
        g[nk] = cost;
        came[nk] = cur.v;
        open.push({ v: nv, f: cost + h(nv) });
      }
    }
  }
  return null;
}

export function tileDistance(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
