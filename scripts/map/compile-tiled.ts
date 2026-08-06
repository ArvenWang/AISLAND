// Compiles the Tiled source map into the runtime map JSON used by the server
// and copies generated atlas images into public/generated/maps/aisland-mvp2/.

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import {
  MAP_W,
  MAP_H,
  MOVE_COST,
  VISION_OPACITY,
  SOUND_COST,
  ELEVATION,
  TERRAIN_INDEX,
  type TerrainClass,
} from './generate-map';
import { cellIndex, type RuntimeMap, type RuntimeMapObject } from './map-types';

type TmjTileset = { firstgid: number; source: string };
type TmjLayer = {
  id: number;
  name: string;
  type: string;
  data?: number[];
  objects?: Array<{
    id: number;
    name: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    properties?: Array<{ name: string; type: string; value: string | number | boolean }>;
  }>;
};

export function loadTmj(tmjPath: string): { map: unknown; tilesets: TmjTileset[]; layers: TmjLayer[] } {
  const map = JSON.parse(fs.readFileSync(tmjPath, 'utf8'));
  return { map, tilesets: map.tilesets, layers: map.layers };
}

export function loadTsjClassMap(tsjPath: string): Map<number, TerrainClass> {
  const tsj = JSON.parse(fs.readFileSync(tsjPath, 'utf8'));
  const m = new Map<number, TerrainClass>();
  for (const t of tsj.tiles ?? []) {
    m.set(t.id, t.type as TerrainClass);
  }
  return m;
}

export function compileTiled(sourceDir: string, outDir: string): RuntimeMap {
  const tmj = JSON.parse(fs.readFileSync(path.join(sourceDir, 'maps', 'aisland-mvp2.tmj'), 'utf8'));
  const terrainTsj = JSON.parse(fs.readFileSync(path.join(sourceDir, 'tilesets', 'terrain.tsj'), 'utf8'));
  const decalCount = JSON.parse(fs.readFileSync(path.join(sourceDir, 'tilesets', 'decals.tsj'), 'utf8')).tilecount as number;

  const classByGid = new Map<number, TerrainClass>();
  terrainTsj.tiles.forEach((t: { id: number; type: string }) => classByGid.set(t.id + 1, t.type as TerrainClass));

  const layers = tmj.layers as TmjLayer[];
  const ground = layers.find((l) => l.name === 'TerrainBase');
  const decals = layers.find((l) => l.name === 'GroundDecals');
  if (!ground || !ground.data) throw new Error('TerrainBase layer missing');

  const terrainClass: number[] = ground.data.map((gid: number) => {
    const cls = classByGid.get(gid);
    return cls ? TERRAIN_INDEX[cls] : 0;
  });
  const terrainCls = (x: number, y: number): TerrainClass => {
    const idx = terrainClass[cellIndex(x, y, MAP_W)];
    return (Object.keys(TERRAIN_INDEX) as TerrainClass[]).find((k) => TERRAIN_INDEX[k] === idx) ?? 'deep';
  };

  const collision = new Array<number>(MAP_W * MAP_H).fill(0);
  const moveCost = new Array<number>(MAP_W * MAP_H).fill(4);
  const visionOpacity = new Array<number>(MAP_W * MAP_H).fill(0);
  const soundCost = new Array<number>(MAP_W * MAP_H).fill(1);
  const elevation = new Array<number>(MAP_W * MAP_H).fill(0);

  for (let i = 0; i < ground.data.length; i++) {
    const cls = terrainCls(i % MAP_W, Math.floor(i / MAP_W));
    if (!isFinite(MOVE_COST[cls]) || MOVE_COST[cls] >= 1e9) collision[i] = 1;
    moveCost[i] = isFinite(MOVE_COST[cls]) ? MOVE_COST[cls] * 4 : 1e9;
    visionOpacity[i] = VISION_OPACITY[cls] ?? 0;
    soundCost[i] = SOUND_COST[cls] ?? 1;
    elevation[i] = ELEVATION[cls] ?? 0;
  }

  // Objects: collision from footprint cells.
  const objects: RuntimeMapObject[] = [];
  const blockTypes = new Set(['tree', 'rock', 'wreckage']);
  for (const layer of layers) {
    if (layer.type !== 'objectgroup' || layer.name === 'Foreground') continue;
    for (const o of layer.objects ?? []) {
      const cellX = Math.round(o.x / 32);
      const cellY = Math.round(o.y / 32);
      const props: Record<string, string | number | boolean> = {};
      for (const p of o.properties ?? []) props[p.name] = p.value;
      objects.push({
        id: o.id,
        name: o.name,
        type: o.type,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        cellX,
        cellY,
        properties: props,
      });
      if (blockTypes.has(o.type)) {
        const wc = Math.max(1, Math.ceil(o.width / 32));
        const hc = Math.max(1, Math.ceil(o.height / 32));
        for (let dy = 0; dy < hc; dy++) {
          for (let dx = 0; dx < wc; dx++) {
            const x = cellX + dx;
            const y = cellY + dy;
            if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) collision[cellIndex(x, y, MAP_W)] = 1;
          }
        }
      }
    }
  }

  // Spawn points must be collision-free.
  const spawnPoints = objects
    .filter((o) => o.type === 'spawn_point')
    .sort((a, b) => Number(a.properties.agentSlot ?? 0) - Number(b.properties.agentSlot ?? 0))
    .map((o) => ({ x: o.cellX, y: o.cellY }));
  for (const s of spawnPoints) collision[cellIndex(s.x, s.y, MAP_W)] = 0;

  // Chunks 32x32.
  const chunkSize = 32;
  const chunks: RuntimeMap['chunks'] = {};
  for (let cy = 0; cy < MAP_H / chunkSize; cy++) {
    for (let cx = 0; cx < MAP_W / chunkSize; cx++) {
      const gids: number[] = [];
      const dec: number[] = [];
      for (let y = 0; y < chunkSize; y++) {
        for (let x = 0; x < chunkSize; x++) {
          const gx = cx * chunkSize + x;
          const gy = cy * chunkSize + y;
          gids.push(ground.data[cellIndex(gx, gy, MAP_W)]);
          dec.push(decals?.data ? decals.data[cellIndex(gx, gy, MAP_W)] : 0);
        }
      }
      chunks[`${cx},${cy}`] = { x: cx, y: cy, gids, decals: dec };
    }
  }

  // Copy atlases.
  const srcNorm = path.join(sourceDir, 'normalized-32px');
  const dst = outDir;
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['terrain.png', 'decals.png', 'props.png', 'effects.png', 'characters.png', 'characters.meta.json', 'props.meta.json']) {
    fs.copyFileSync(path.join(srcNorm, f), path.join(dst, f));
  }
  const terrainPng = PNG.sync.read(fs.readFileSync(path.join(dst, 'terrain.png')));
  const decalPng = PNG.sync.read(fs.readFileSync(path.join(dst, 'decals.png')));

  const stats = {
    terrainRatios: {} as Record<string, number>,
    travelMinutesSpawnToFarthest: 0,
    detourCells: 0,
    treeCount: objects.filter((o) => o.type === 'tree').length,
    resourceCount: objects.filter((o) => ['water_spring', 'berry_bush', 'wood_pile'].includes(o.type)).length,
  };
  const counts = new Map<number, number>();
  for (const c of terrainClass) counts.set(c, (counts.get(c) ?? 0) + 1);
  for (const [k, v] of counts) {
    stats.terrainRatios[Object.keys(TERRAIN_INDEX).find((kk) => TERRAIN_INDEX[kk as TerrainClass] === k) ?? String(k)] = v / ground.data.length;
  }

  const runtime: RuntimeMap = {
    version: 'mvp2-map-v1',
    seed: tmj.properties?.find((p: { name: string }) => p.name === 'seed')?.value ?? 0,
    width: MAP_W,
    height: MAP_H,
    tileSize: 32,
    chunkSize,
    chunks,
    collision,
    moveCost,
    visionOpacity,
    soundCost,
    elevation,
    terrainClass,
    objects,
    spawnPoints,
    inlet: tmj.properties?.find((p: { name: string }) => p.name === 'inlet')?.value
      ? JSON.parse(tmj.properties.find((p: { name: string }) => p.name === 'inlet').value)
      : null,
    atlas: {
      terrain: 'terrain.png',
      decals: 'decals.png',
      props: 'props.png',
      effects: 'effects.png',
      characters: 'characters.png',
      terrainCols: Math.floor(terrainPng.width / 32),
      decalCols: Math.floor(decalPng.width / 32),
    },
    sourceHash: tmj.properties?.find((p: { name: string }) => p.name === 'sourceHash')?.value ?? '',
    stats,
  };

  fs.writeFileSync(path.join(dst, 'map.runtime.json'), JSON.stringify(runtime));
  return runtime;
}

export function build() {
  const root = path.join(__dirname, '../..');
  const sourceDir = path.join(root, 'assets/source/mvp2');
  const outDir = path.join(root, 'public/generated/maps/aisland-mvp2');
  const map = compileTiled(sourceDir, outDir);
  console.log(
    JSON.stringify({
      seed: map.seed,
      chunks: Object.keys(map.chunks).length,
      objects: map.objects.length,
      trees: map.stats.treeCount,
      resources: map.stats.resourceCount,
      spawn: map.spawnPoints,
      ratios: map.stats.terrainRatios,
    }, null, 1),
  );
}

if (require.main === module) build();
