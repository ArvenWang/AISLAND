/**
 * Phase 3 map compiler.
 *
 * The TMJ is the only macro-map source of truth. This compiler decodes the
 * authored Tiled layers, derives typed runtime grids, and copies the already
 * authored atlases. It never changes the TMJ and never invents island
 * topology, terrain edges, or resource locations.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { PNG } from 'pngjs';
import type { RuntimeMapData, RuntimeMapObject } from '../../server/engine/map/runtimeMap';

const WIDTH = 80;
const HEIGHT = 52;
const TILE_SIZE = 32;
const CHUNK_SIZE = 32;
const PHASE3_MOVEMENT_SCALE = 7;
const TERRAIN_NAMES = ['deep', 'shallow', 'wetSand', 'drySand', 'grass', 'rock'] as const;
type TerrainName = (typeof TERRAIN_NAMES)[number];

type TiledProperty = { name: string; type?: string; value: string | number | boolean };
type TiledObject = {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
};
type TiledLayer = {
  id: number;
  name: string;
  type: 'tilelayer' | 'objectgroup';
  width?: number;
  height?: number;
  data?: number[] | string;
  encoding?: 'base64' | 'csv';
  compression?: 'zlib' | 'gzip';
  objects?: TiledObject[];
  properties?: TiledProperty[];
};
type TiledMap = {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  properties?: TiledProperty[];
  tilesets: Array<{ firstgid: number; source: string }>;
};
type Phase3Tileset = {
  tilecount: number;
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  tiles?: Array<{ id: number; type: TerrainName; wangid?: number[] }>;
  wangsets?: Array<{ name: string; type?: string; colors?: Array<{ name: string }>; wangtiles?: Array<{ tileid: number; wangid: number[] }> }>;
};

const root = path.join(__dirname, '../..');
export const PHASE3_SOURCE_DIR = path.join(root, 'assets/source/phase3');
export const PHASE3_MAP_FILE = path.join(root, 'assets/source/phase31/maps/island-01-small.tmj');
export const PHASE3_OUTPUT_DIR = path.join(root, 'public/generated/maps/island-01');
export const PHASE3_EVIDENCE_DIR = path.join(root, 'acceptance/phase31/map');

function property(layerOrMap: { properties?: TiledProperty[] }, name: string): string | number | boolean | undefined {
  return layerOrMap.properties?.find((p) => p.name === name)?.value;
}

function decodeLayerData(layer: TiledLayer): number[] {
  if (Array.isArray(layer.data)) return layer.data;
  if (typeof layer.data !== 'string') return [];
  if (layer.encoding === 'csv') return layer.data.split(',').map((v) => Number(v.trim()) || 0);
  const encoded = Buffer.from(layer.data, 'base64');
  const raw = layer.compression === 'gzip' ? zlib.gunzipSync(encoded) : layer.compression === 'zlib' ? zlib.inflateSync(encoded) : encoded;
  const out: number[] = [];
  for (let offset = 0; offset + 4 <= raw.length; offset += 4) out.push(raw.readUInt32LE(offset));
  return out;
}

function asProps(object: TiledObject): Record<string, string | number | boolean> {
  return Object.fromEntries((object.properties ?? []).map((p) => [p.name, p.value]));
}

function cellIndex(x: number, y: number): number {
  return y * WIDTH + x;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
}

function layerByName(map: TiledMap, name: string): TiledLayer | undefined {
  return map.layers.find((layer) => layer.name === name);
}

function loadSource(): { map: TiledMap; tileset: Phase3Tileset; sourceText: string } {
  const sourceText = fs.readFileSync(PHASE3_MAP_FILE, 'utf8');
  const map = JSON.parse(sourceText) as TiledMap;
  const tilesetRef = map.tilesets.find((entry) => entry.source.endsWith('terrain.tsj'));
  if (!tilesetRef) throw new Error('Phase3 source map must reference terrain.tsj');
  const tileset = JSON.parse(fs.readFileSync(path.resolve(path.dirname(PHASE3_MAP_FILE), tilesetRef.source), 'utf8')) as Phase3Tileset;
  return { map, tileset, sourceText };
}

function defaultMoveCost(terrain: TerrainName): number {
  return { deep: Infinity, shallow: Infinity, wetSand: 1.3, drySand: 0.9, grass: 1.1, rock: 1.8 }[terrain] * PHASE3_MOVEMENT_SCALE;
}

function defaultVisionOpacity(terrain: TerrainName): number {
  return terrain === 'rock' ? 0.35 : 0;
}

function defaultSoundCost(terrain: TerrainName): number {
  return { deep: 1, shallow: 1, wetSand: 2, drySand: 2, grass: 3, rock: 4 }[terrain];
}

function buildRuntime(): RuntimeMapData {
  const { map, tileset, sourceText } = loadSource();
  if (map.width !== WIDTH || map.height !== HEIGHT || map.tilewidth !== TILE_SIZE || map.tileheight !== TILE_SIZE) {
    throw new Error(`Phase3 TMJ must be ${WIDTH}x${HEIGHT} with ${TILE_SIZE}px tiles`);
  }

  const requiredLayers = ['TerrainBase', 'GroundDecals', 'CliffFace', 'LowProps', 'TallProps', 'Canopy', 'Spawn', 'ResourceNodes', 'Landmarks', 'HiddenSpots', 'Collision', 'MoveCost', 'VisionOpacity', 'SoundCost', 'Elevation', 'RegionId'];
  for (const name of requiredLayers) if (!layerByName(map, name)) throw new Error(`Phase3 layer missing: ${name}`);

  const ground = layerByName(map, 'TerrainBase')!;
  const decals = layerByName(map, 'GroundDecals')!;
  const cliffFaces = layerByName(map, 'CliffFace')!;
  const groundGids = decodeLayerData(ground);
  const decalGids = decodeLayerData(decals);
  const cliffSource = map.tilesets.find((entry) => entry.source.endsWith('cliffs.tsj'));
  if (!cliffSource) throw new Error('Phase3 source map must reference cliffs.tsj');
  const rawCliffGids = decodeLayerData(cliffFaces);
  const cliffGids = rawCliffGids.map((gid) => gid > 0 ? gid - cliffSource.firstgid + 1 : 0);
  if (groundGids.length !== WIDTH * HEIGHT) throw new Error(`TerrainBase has ${groundGids.length} cells, expected ${WIDTH * HEIGHT}`);

  const classByGid = new Map<number, TerrainName>();
  for (const tile of tileset.tiles ?? []) classByGid.set(tile.id + 1, tile.type);
  const terrainClass: number[] = groundGids.map((gid) => {
    const terrain = classByGid.get(gid);
    if (!terrain) throw new Error(`TerrainBase references unknown phase3 terrain GID ${gid}`);
    return TERRAIN_NAMES.indexOf(terrain);
  });
  const terrainAt = (x: number, y: number): TerrainName => TERRAIN_NAMES[terrainClass[cellIndex(x, y)]];

  const collisionValues = decodeLayerData(layerByName(map, 'Collision')!);
  const moveValues = decodeLayerData(layerByName(map, 'MoveCost')!);
  const visionValues = decodeLayerData(layerByName(map, 'VisionOpacity')!);
  const soundValues = decodeLayerData(layerByName(map, 'SoundCost')!);
  const elevationValues = decodeLayerData(layerByName(map, 'Elevation')!);
  const regionId = decodeLayerData(layerByName(map, 'RegionId')!);
  const moveCost = terrainClass.map((_, i) => {
    const raw = moveValues[i] ?? 0;
    return raw > 0 ? raw / 10 : defaultMoveCost(terrainAt(i % WIDTH, Math.floor(i / WIDTH)));
  });
  const visionOpacity = terrainClass.map((_, i) => {
    const raw = visionValues[i] ?? 0;
    return raw > 0 ? raw / 100 : defaultVisionOpacity(terrainAt(i % WIDTH, Math.floor(i / WIDTH)));
  });
  const soundCost = terrainClass.map((_, i) => soundValues[i] || defaultSoundCost(terrainAt(i % WIDTH, Math.floor(i / WIDTH))));
  const elevation = terrainClass.map((_, i) => elevationValues[i] ?? 0);
  const collision = terrainClass.map((terrain, i) => (terrain <= 1 || (collisionValues[i] ?? 0) > 0 ? 1 : 0));

  const objects: RuntimeMapObject[] = [];
  const blockTypes = new Set(['tree', 'rock', 'cliff', 'wreck_main', 'wreck_tail']);
  for (const layer of map.layers) {
    if (layer.type !== 'objectgroup' || layer.name === 'Canopy') continue;
    for (const object of layer.objects ?? []) {
      const props = asProps(object);
      const cellX = Number(props.footCellX ?? Math.round(object.x / TILE_SIZE));
      const cellY = Number(props.footCellY ?? Math.round(object.y / TILE_SIZE));
      objects.push({ id: object.id, name: object.name, type: object.type, x: object.x, y: object.y, width: object.width, height: object.height, cellX, cellY, properties: props });
      if (blockTypes.has(object.type)) {
        const cellsWide = Math.max(1, Number(props.collisionWidth ?? (object.type === 'cliff' ? Math.ceil(object.width / TILE_SIZE) : 1)));
        const cellsHigh = Math.max(1, Number(props.collisionHeight ?? (object.type === 'cliff' ? Math.ceil(object.height / TILE_SIZE) : 1)));
        for (let dy = 0; dy < cellsHigh; dy++) {
          for (let dx = 0; dx < cellsWide; dx++) {
            const x = cellX + dx;
            const y = cellY + dy;
            if (!inBounds(x, y)) continue;
            const i = cellIndex(x, y);
            if (object.type === 'cliff' || props.collision === true || object.type === 'tree' || object.type === 'rock' || object.type === 'wreck_main' || object.type === 'wreck_tail') collision[i] = 1;
            if (object.type === 'tree') visionOpacity[i] = Math.max(visionOpacity[i], 0.72);
            if (object.type === 'rock' || object.type === 'cliff') visionOpacity[i] = Math.max(visionOpacity[i], 0.85);
          }
        }
      }
    }
  }

  const spawnPoints = objects
    .filter((object) => object.type === 'spawn_point')
    .sort((a, b) => Number(a.properties.agentSlot ?? 0) - Number(b.properties.agentSlot ?? 0))
    .map((object) => ({ x: object.cellX, y: object.cellY }));
  if (spawnPoints.length !== 3) throw new Error(`Phase3 requires exactly 3 spawn points, found ${spawnPoints.length}`);
  for (const spawn of spawnPoints) collision[cellIndex(spawn.x, spawn.y)] = 0;

  const chunks: RuntimeMapData['chunks'] = {};
  const decalValues = decalGids.length === WIDTH * HEIGHT ? decalGids : new Array(WIDTH * HEIGHT).fill(0);
  for (let cy = 0; cy < Math.ceil(HEIGHT / CHUNK_SIZE); cy++) {
    for (let cx = 0; cx < Math.ceil(WIDTH / CHUNK_SIZE); cx++) {
      const gids: number[] = [];
      const dec: number[] = [];
      const cliffs: number[] = [];
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const gx = cx * CHUNK_SIZE + x;
          const gy = cy * CHUNK_SIZE + y;
          gids.push(inBounds(gx, gy) ? groundGids[cellIndex(gx, gy)] : 0);
          dec.push(inBounds(gx, gy) ? decalValues[cellIndex(gx, gy)] : 0);
          cliffs.push(inBounds(gx, gy) ? (cliffGids[cellIndex(gx, gy)] ?? 0) : 0);
        }
      }
      chunks[`${cx},${cy}`] = { x: cx, y: cy, gids, decals: dec, cliffs };
    }
  }

  fs.mkdirSync(PHASE3_OUTPUT_DIR, { recursive: true });
  const sourceAtlasDir = path.join(PHASE3_SOURCE_DIR, 'atlases');
  for (const file of ['terrain.png', 'cliffs.png', 'decals.png', 'props.png', 'effects.png', 'characters.png', 'props.meta.json', 'characters.meta.json', 'decals.meta.json', 'effects.meta.json']) {
    fs.copyFileSync(path.join(sourceAtlasDir, file), path.join(PHASE3_OUTPUT_DIR, file));
  }
  const terrainPng = PNG.sync.read(fs.readFileSync(path.join(PHASE3_OUTPUT_DIR, 'terrain.png')));
  const decalPng = PNG.sync.read(fs.readFileSync(path.join(PHASE3_OUTPUT_DIR, 'decals.png')));
  const cliffPng = PNG.sync.read(fs.readFileSync(path.join(PHASE3_OUTPUT_DIR, 'cliffs.png')));
  const propsPng = PNG.sync.read(fs.readFileSync(path.join(PHASE3_OUTPUT_DIR, 'props.png')));
  const charPng = PNG.sync.read(fs.readFileSync(path.join(PHASE3_OUTPUT_DIR, 'characters.png')));

  const counts: Record<string, number> = {};
  for (const terrain of terrainClass) counts[TERRAIN_NAMES[terrain]] = (counts[TERRAIN_NAMES[terrain]] ?? 0) + 1;
  const objectCounts: Record<string, number> = {};
  for (const object of objects) objectCounts[object.type] = (objectCounts[object.type] ?? 0) + 1;
  const focusX = Number(property(map, 'focusX') ?? spawnPoints[1].x);
  const focusY = Number(property(map, 'focusY') ?? spawnPoints[1].y);
  const runtime: RuntimeMapData = {
    version: String(property(map, 'version') ?? 'phase3-map-v2'),
    seed: 0,
    width: WIDTH,
    height: HEIGHT,
    tileSize: TILE_SIZE,
    chunkSize: CHUNK_SIZE,
    chunks,
    collision,
    moveCost,
    visionOpacity,
    soundCost,
    elevation,
    terrainClass,
    regionId,
    objects,
    spawnPoints,
    startFocus: { x: focusX, y: focusY },
    inlet: null,
    atlas: {
      terrain: 'terrain.png',
      decals: 'decals.png',
      cliffs: 'cliffs.png',
      props: 'props.png',
      effects: 'effects.png',
      characters: 'characters.png',
      terrainCols: Math.floor(terrainPng.width / TILE_SIZE),
      decalCols: Math.floor(decalPng.width / TILE_SIZE),
      cliffCols: Math.floor(cliffPng.width / TILE_SIZE),
    },
    sourceHash: crypto.createHash('sha256').update(sourceText).digest('hex'),
    stats: {
      terrainCounts: counts,
      objectCounts,
      requiredTopology: { bottlenecks: 2, routeFamilies: 3, hiddenSpots: 1, viewpoints: 1, routeLoops: 1 },
      mapSource: 'assets/source/phase31/maps/island-01-small.tmj',
      authored: true,
      atlas: { terrain: [terrainPng.width, terrainPng.height], props: [propsPng.width, propsPng.height], characters: [charPng.width, charPng.height] },
    },
  };
  fs.writeFileSync(path.join(PHASE3_OUTPUT_DIR, 'map.runtime.json'), JSON.stringify(runtime));
  return runtime;
}

function writePreview(runtime: RuntimeMapData): void {
  fs.mkdirSync(PHASE3_EVIDENCE_DIR, { recursive: true });
  const terrainPng = PNG.sync.read(fs.readFileSync(path.join(PHASE3_OUTPUT_DIR, runtime.atlas.terrain)));
  const render = (scale: number, x0 = 0, y0 = 0, x1 = WIDTH, y1 = HEIGHT): PNG => {
    const out = new PNG({ width: (x1 - x0) * scale, height: (y1 - y0) * scale });
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const gid = runtime.chunks[`${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)}`].gids[(y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)];
        if (!gid) continue;
        const tileX = ((gid - 1) % runtime.atlas.terrainCols) * TILE_SIZE;
        const tileY = Math.floor((gid - 1) / runtime.atlas.terrainCols) * TILE_SIZE;
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const sx = tileX + Math.floor((px / scale) * TILE_SIZE);
            const sy = tileY + Math.floor((py / scale) * TILE_SIZE);
            const si = (sy * terrainPng.width + sx) * 4;
            const di = (((y - y0) * scale + py) * out.width + (x - x0) * scale + px) * 4;
            out.data[di] = terrainPng.data[si];
            out.data[di + 1] = terrainPng.data[si + 1];
            out.data[di + 2] = terrainPng.data[si + 2];
            out.data[di + 3] = 255;
          }
        }
      }
    }
    return out;
  };
  const write = (file: string, image: PNG) => image.pack().pipe(fs.createWriteStream(path.join(PHASE3_EVIDENCE_DIR, file)));
  write('full-map.png', render(4));
  const regions: Array<[string, number, number, number, number]> = [
    ['beach-spawn', 10, 39, 37, 52],
    ['forest-mouth', 24, 32, 43, 45],
    ['spring-valley', 34, 25, 49, 37],
    ['ridge-viewpoint', 47, 14, 64, 29],
    ['opposite-edge', 24, 4, 62, 17],
  ];
  for (const [name, x0, y0, x1, y1] of regions) write(`region-${name}.png`, render(8, x0, y0, x1, y1));
  fs.writeFileSync(path.join(PHASE3_EVIDENCE_DIR, 'topology.json'), JSON.stringify(runtime.stats, null, 2));
}

export function buildPhase3Map(): RuntimeMapData {
  const runtime = buildRuntime();
  writePreview(runtime);
  console.log(JSON.stringify({ version: runtime.version, size: [runtime.width, runtime.height], objects: runtime.objects.length, spawn: runtime.spawnPoints, focus: runtime.startFocus, sourceHash: runtime.sourceHash }, null, 2));
  return runtime;
}

if (require.main === module) buildPhase3Map();
