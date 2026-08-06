// MVP2 runtime map: loads the compiled Tiled map (map.runtime.json) and
// provides typed grids + object lookup. Server-authoritative geometry.

import * as fs from 'fs';
import * as path from 'path';

export type RuntimeMapObject = {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cellX: number;
  cellY: number;
  properties: Record<string, string | number | boolean>;
};

export type RuntimeChunk = {
  x: number;
  y: number;
  gids: number[];
  decals: number[];
};

export type RuntimeMapData = {
  version: 'mvp2-map-v1';
  seed: number;
  width: number;
  height: number;
  tileSize: 32;
  chunkSize: number;
  chunks: Record<string, RuntimeChunk>;
  collision: number[];
  moveCost: number[];
  visionOpacity: number[];
  soundCost: number[];
  elevation: number[];
  terrainClass: number[];
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
  stats: Record<string, unknown>;
};

export const TERRAIN_NAMES = ['deep', 'shallow', 'wetSand', 'drySand', 'grass', 'sparse', 'dense', 'mud', 'rock', 'cliff', 'path'] as const;

export class RuntimeMap {
  readonly data: RuntimeMapData;
  private constructor(data: RuntimeMapData) {
    this.data = data;
  }

  static loadFromFile(file: string): RuntimeMap {
    return new RuntimeMap(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  static loadDefault(): RuntimeMap {
    const root = path.join(__dirname, '../../..');
    return RuntimeMap.loadFromFile(path.join(root, 'public/generated/maps/aisland-mvp2/map.runtime.json'));
  }

  get width(): number {
    return this.data.width;
  }

  get height(): number {
    return this.data.height;
  }

  idx(x: number, y: number): number {
    return y * this.data.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.data.width && y < this.data.height;
  }

  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.data.collision[this.idx(x, y)] === 1;
  }

  moveCost(x: number, y: number): number {
    if (!this.inBounds(x, y)) return Infinity;
    return this.data.moveCost[this.idx(x, y)];
  }

  terrainAt(x: number, y: number): string {
    if (!this.inBounds(x, y)) return 'deep';
    return TERRAIN_NAMES[this.data.terrainClass[this.idx(x, y)]] ?? 'deep';
  }

  elevationAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.data.elevation[this.idx(x, y)];
  }

  objectsOfType(type: string): RuntimeMapObject[] {
    return this.data.objects.filter((o) => o.type === type);
  }

  spawnPoint(i: number): { x: number; y: number } {
    return this.data.spawnPoints[Math.min(i, this.data.spawnPoints.length - 1)] ?? { x: 128, y: 170 };
  }
}
