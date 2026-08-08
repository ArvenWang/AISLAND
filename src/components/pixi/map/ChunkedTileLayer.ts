// Per-chunk CompositeTilemap layers with camera culling (PRD 5.4: no per-tile
// sprites, only visible chunks are mounted).

import { CompositeTilemap } from '@pixi/tilemap';
import * as PIXI from 'pixi.js';
import type { RuntimeMapData } from '../../../../server/engine/map/runtimeMap';

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

export class ChunkedTileLayer extends PIXI.Container {
  private map: RuntimeMapData;
  private atlas: PIXI.Texture;
  private cols: number;
  private source: 'terrain' | 'decals' | 'cliffs';
  private chunkMaps = new Map<string, CompositeTilemap>();
  private lastBounds: Bounds | null = null;

  constructor(map: RuntimeMapData, atlas: PIXI.Texture, cols: number, source: 'terrain' | 'decals' | 'cliffs') {
    super();
    this.map = map;
    this.atlas = atlas;
    this.cols = cols;
    this.source = source;
  }

  private buildChunk(cx: number, cy: number): CompositeTilemap {
    const key = `${cx},${cy}`;
    const chunk = this.map.chunks[key];
    if (!chunk) return new CompositeTilemap();
    const tm = new CompositeTilemap();
    tm.position.set(cx * this.map.chunkSize * this.map.tileSize, cy * this.map.chunkSize * this.map.tileSize);
    const cs = this.map.chunkSize;
    for (let y = 0; y < cs; y++) {
      for (let x = 0; x < cs; x++) {
        const gid = this.source === 'decals'
          ? chunk.decals[y * cs + x]
          : this.source === 'cliffs'
            ? (chunk.cliffs?.[y * cs + x] ?? 0)
            : chunk.gids[y * cs + x];
        if (gid <= 0) continue;
        const idx = gid - 1;
        const u = (idx % this.cols) * this.map.tileSize;
        const v = Math.floor(idx / this.cols) * this.map.tileSize;
        tm.tile(this.atlas, x * this.map.tileSize, y * this.map.tileSize, {
          u,
          v,
          tileWidth: this.map.tileSize,
          tileHeight: this.map.tileSize,
        });
      }
    }
    this.chunkMaps.set(key, tm);
    this.addChild(tm);
    return tm;
  }

  update(bounds: Bounds) {
    if (this.lastBounds && this.lastBounds.x0 === bounds.x0 && this.lastBounds.y0 === bounds.y0 && this.lastBounds.x1 === bounds.x1 && this.lastBounds.y1 === bounds.y1) {
      return;
    }
    this.lastBounds = bounds;
    const cs = this.map.chunkSize;
    const wanted = new Set<string>();
    for (let cy = Math.floor(bounds.y0 / cs); cy <= Math.floor(bounds.y1 / cs); cy++) {
      for (let cx = Math.floor(bounds.x0 / cs); cx <= Math.floor(bounds.x1 / cs); cx++) {
        wanted.add(`${cx},${cy}`);
      }
    }
    for (const [key, tm] of this.chunkMaps) {
      if (!wanted.has(key)) {
        this.removeChild(tm);
        tm.destroy({ children: true });
        this.chunkMaps.delete(key);
      }
    }
    for (const key of wanted) {
      if (!this.chunkMaps.has(key)) {
        this.buildChunk(parseInt(key.split(',')[0], 10), parseInt(key.split(',')[1], 10));
      }
    }
  }

  destroy(options?: PIXI.IDestroyOptions | boolean) {
    for (const tm of this.chunkMaps.values()) tm.destroy({ children: true });
    this.chunkMaps.clear();
    super.destroy(options);
  }
}
