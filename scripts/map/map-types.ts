// Shared runtime map types (mirrors server/engine/map/runtimeMap.ts).

export type RuntimeMapObject = {
  id: number;
  name: string;
  type: string;
  x: number; // px
  y: number; // px
  width: number;
  height: number;
  cellX: number;
  cellY: number;
  properties: Record<string, string | number | boolean>;
};

export type RuntimeChunk = {
  x: number;
  y: number;
  gids: number[]; // width*height gids into the terrain atlas (0 = none)
  decals: number[]; // decal gids (0 = none)
};

export type RuntimeMap = {
  version: 'mvp2-map-v1';
  seed: number;
  width: number;
  height: number;
  tileSize: 32;
  chunkSize: number;
  chunks: Record<string, RuntimeChunk>;
  collision: number[]; // 1 = blocked
  moveCost: number[]; // island-minutes per cell
  visionOpacity: number[]; // 0..1
  soundCost: number[];
  elevation: number[];
  terrainClass: number[]; // TERRAIN_INDEX
  objects: RuntimeMapObject[];
  spawnPoints: Array<{ x: number; y: number }>;
  inlet: { headX: number; mouthX: number; y0: number; y1: number } | null;
  atlas: {
    terrain: string;
    decals: string;
    props: string;
    effects: string;
    characters: string;
    terrainCols: number;
    decalCols: number;
  };
  sourceHash: string;
  stats: {
    terrainRatios: Record<string, number>;
    travelMinutesSpawnToFarthest: number;
    detourCells: number;
    treeCount: number;
    resourceCount: number;
  };
};

export function cellIndex(x: number, y: number, width: number): number {
  return y * width + x;
}
