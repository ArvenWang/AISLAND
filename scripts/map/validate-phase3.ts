import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { PHASE3_EVIDENCE_DIR, PHASE3_MAP_FILE, PHASE3_OUTPUT_DIR } from './compile-phase3';

const W = 144;
const H = 112;
const names = ['deep', 'shallow', 'wetSand', 'drySand', 'grass', 'rock'] as const;
type Name = (typeof names)[number];
const requiredLayers = ['TerrainBase', 'GroundDecals', 'CliffFace', 'LowProps', 'TallProps', 'Canopy', 'Spawn', 'ResourceNodes', 'Landmarks', 'HiddenSpots', 'Collision', 'MoveCost', 'VisionOpacity', 'SoundCost', 'Elevation', 'RegionId'];

type Layer = { name: string; type: string; data?: number[] | string; encoding?: string; compression?: string; objects?: Array<{ type: string; properties?: Array<{ name: string; value: string | number | boolean }> }> };
type WangTile = { tileid: number; wangid: number[] };
type TerrainTileset = {
  tilecount: number;
  columns: number;
  imagewidth: number;
  imageheight: number;
  tiles?: Array<{ id: number; type: Name }>;
  wangsets?: Array<{ type?: string; tiles?: WangTile[]; wangtiles?: WangTile[] }>;
};

function decode(layer: Layer): number[] {
  if (Array.isArray(layer.data)) return layer.data;
  if (typeof layer.data !== 'string') return [];
  if (layer.encoding === 'csv') return layer.data.split(',').map((value) => Number(value.trim()) || 0);
  const encoded = Buffer.from(layer.data, 'base64');
  const raw = layer.compression === 'zlib' ? zlib.inflateSync(encoded) : layer.compression === 'gzip' ? zlib.gunzipSync(encoded) : encoded;
  const data: number[] = [];
  for (let offset = 0; offset < raw.length; offset += 4) data.push(raw.readUInt32LE(offset));
  return data;
}

function fail(message: string): never {
  throw new Error(`[phase3 map] ${message}`);
}

function toOfficialWang(signature: [number, number, number, number]): number[] {
  const [nw0, ne0, sw0, se0] = signature;
  const [nw, ne, sw, se] = [nw0 + 1, ne0 + 1, sw0 + 1, se0 + 1];
  return [
    nw === ne ? nw : 0,
    ne,
    ne === se ? ne : 0,
    se,
    sw === se ? sw : 0,
    sw,
    nw === sw ? nw : 0,
    nw,
  ];
}

export function validatePhase3Map(): Record<string, unknown> {
  const sourceText = fs.readFileSync(PHASE3_MAP_FILE, 'utf8');
  const source = JSON.parse(sourceText) as { width: number; height: number; tilewidth: number; tileheight: number; layers: Layer[]; tilesets: Array<{ firstgid: number; source: string }>; properties?: Array<{ name: string; value: string | number | boolean }> };
  const tileset = JSON.parse(fs.readFileSync(path.join(path.dirname(PHASE3_MAP_FILE), '..', 'tilesets/terrain.tsj'), 'utf8')) as TerrainTileset;
  const cliffTileset = JSON.parse(fs.readFileSync(path.join(path.dirname(PHASE3_MAP_FILE), '..', 'tilesets/cliffs.tsj'), 'utf8')) as TerrainTileset;
  const runtime = JSON.parse(fs.readFileSync(path.join(PHASE3_OUTPUT_DIR, 'map.runtime.json'), 'utf8')) as { sourceHash: string; width: number; height: number; objects: Array<{ type: string; cellX: number; cellY: number }>; spawnPoints: Array<{ x: number; y: number }>; terrainClass: number[]; chunks: Record<string, { gids: number[] }> };
  if (source.width !== W || source.height !== H || source.tilewidth !== 32 || source.tileheight !== 32) fail('source map geometry is not 144x112 at 32px');
  const layerNames = new Set(source.layers.map((layer) => layer.name));
  for (const name of requiredLayers) if (!layerNames.has(name)) fail(`missing required layer ${name}`);
  const authoredTopology = source.properties?.find((property) => property.name === 'authoredTopology')?.value;
  if (authoredTopology !== true) fail('source map is not marked authoredTopology');
  const visualAssetVersion = source.properties?.find((property) => property.name === 'visualAssetVersion')?.value;
  if (visualAssetVersion !== 'phase3-visual-v2') fail('source map is not installed with phase3-visual-v2');
  const mapDesignVersion = source.properties?.find((property) => property.name === 'mapDesignVersion')?.value;
  if (mapDesignVersion !== 'social-topology-v2') fail('source map is not installed with the Phase 3 social topology v2');
  if (sourceText.includes('generate-map.ts')) fail('source map references the old procedural generator');
  const sourceHash = crypto.createHash('sha256').update(sourceText).digest('hex');
  if (sourceHash !== runtime.sourceHash) fail('runtime sourceHash does not match island-01.tmj');

  const terrain = source.layers.find((layer) => layer.name === 'TerrainBase');
  if (!terrain) fail('TerrainBase missing');
  const gids = decode(terrain);
  if (gids.length !== W * H) fail(`TerrainBase length is ${gids.length}`);
  const wangset = tileset.wangsets?.[0];
  if (!wangset || wangset.type !== 'mixed') fail('terrain tileset must use an official Tiled mixed Wang set');
  if (wangset.tiles?.length) fail('legacy custom wangsets[].tiles metadata is forbidden');
  if (!wangset.wangtiles?.length) fail('terrain tileset has no official wangsets[].wangtiles metadata');
  if (wangset.wangtiles.some((tile) => tile.wangid.length !== 8)) fail('all official Wang IDs must have eight positions');
  if (tileset.tilecount !== (tileset.tiles?.length ?? 0)) fail('tileset tilecount does not match tile metadata');
  if (tileset.imagewidth !== tileset.columns * 32 || tileset.imageheight % 32 !== 0) fail('terrain atlas dimensions do not align to the 32px grid');
  const typeByGid = new Map<number, Name>((tileset.tiles ?? []).map((tile) => [tile.id + 1, tile.type]));
  const wangByGid = new Map<number, number[]>(wangset.wangtiles.map((tile) => [tile.tileid + 1, tile.wangid]));
  const classId = new Map<Name, number>(names.map((name, index) => [name, index]));
  let wangMismatches = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gid = gids[y * W + x];
      const current = typeByGid.get(gid);
      if (!current) fail(`unknown terrain gid ${gid}`);
      const actual = wangByGid.get(gid);
      if (!actual) fail(`terrain gid ${gid} has no Wang metadata`);
      const c = classId.get(current)!;
      const nw = x > 0 && y > 0 ? classId.get(typeByGid.get(gids[(y - 1) * W + x - 1])!)! : c;
      const n = y > 0 ? classId.get(typeByGid.get(gids[(y - 1) * W + x])!)! : c;
      const w = x > 0 ? classId.get(typeByGid.get(gids[y * W + x - 1])!)! : c;
      const expected = toOfficialWang([nw, n, w, c]);
      if (actual.some((value, index) => value !== expected[index])) wangMismatches++;
    }
  }
  if (wangMismatches) fail(`${wangMismatches} authored Wang signatures do not match neighboring terrain`);
  const cliffLayer = source.layers.find((layer) => layer.name === 'CliffFace');
  if (!cliffLayer) fail('CliffFace missing');
  const cliffGids = decode(cliffLayer);
  const cliffRef = source.tilesets.find((entry) => entry.source.endsWith('cliffs.tsj'));
  if (!cliffRef) fail('source map does not reference cliffs.tsj');
  const authoredCliffCells = cliffGids.filter((gid) => gid > 0).length;
  if (authoredCliffCells < 100) fail(`expected an authored ridge face, found only ${authoredCliffCells} cliff cells`);
  if (cliffGids.some((gid) => gid > 0 && (gid < cliffRef.firstgid || gid >= cliffRef.firstgid + cliffTileset.tilecount))) fail('CliffFace references a GID outside cliffs.tsj');
  const cliffWang = cliffTileset.wangsets?.[0];
  if (!cliffWang || cliffWang.type !== 'mixed' || !cliffWang.wangtiles?.length || cliffWang.wangtiles.some((tile) => tile.wangid.length !== 8)) {
    fail('cliffs.tsj must use official eight-position Mixed Wang metadata');
  }

  const counts = (types: string[]) => types.reduce<Record<string, number>>((out, type) => { out[type] = (out[type] ?? 0) + 1; return out; }, {});
  const objectTypes = runtime.objects.map((object) => object.type);
  const sourceObjects = source.layers.flatMap((layer) => layer.objects ?? []);
  const itemSpawns = sourceObjects.filter((object) => object.type === 'item_spawn');
  const itemUnits = itemSpawns.reduce<Record<string, number>>((out, object) => {
    const kind = object.properties?.find((property) => property.name === 'itemKind')?.value;
    if (typeof kind === 'string') out[kind] = (out[kind] ?? 0) + 1;
    return out;
  }, {});
  const wreckUnits = sourceObjects.filter((object) => object.type === 'wreckage').reduce<Record<'waterUnits' | 'foodUnits', number>>((out, object) => {
    for (const property of object.properties ?? []) {
      if (property.name === 'waterUnits' || property.name === 'foodUnits') out[property.name] = (out[property.name] ?? 0) + Number(property.value);
    }
    return out;
  }, { waterUnits: 0, foodUnits: 0 });
  if (itemUnits.water_bottle + wreckUnits.waterUnits !== 6) fail(`opening water units must be 6, found ${itemUnits.water_bottle + wreckUnits.waterUnits}`);
  if (itemUnits.food_ration + wreckUnits.foodUnits < 4 || itemUnits.food_ration + wreckUnits.foodUnits > 6) fail(`opening food units must be 4-6, found ${itemUnits.food_ration + wreckUnits.foodUnits}`);
  const stableSprings = objectTypes.filter((type) => type === 'water_spring').length;
  if (stableSprings !== 1) fail(`expected exactly one stable spring, found ${stableSprings}`);
  if (objectTypes.filter((type) => type === 'camp_crate' || type === 'public_inventory').length) fail('public storage object exists');
  const spring = runtime.objects.find((object) => object.type === 'water_spring');
  if (!spring) fail('stable spring missing');
  const springDistance = runtime.spawnPoints.map((spawn) => Math.abs(spawn.x - spring.cellX) + Math.abs(spawn.y - spring.cellY));
  if (Math.min(...springDistance) < 30) fail(`spring is too close to spawn: ${springDistance.join(',')}`);
  const topology = counts(objectTypes);
  for (const [type, minimum] of [['bottleneck', 2], ['hidden_spot', 2], ['landmark_viewpoint', 1], ['route_loop', 1] as const]) {
    if ((topology[type] ?? 0) < minimum) fail(`topology requires ${minimum} ${type}, found ${topology[type] ?? 0}`);
  }
  const terrainCounts = counts(runtime.terrainClass.map((value) => names[value] ?? 'unknown'));
  const terrainQcPath = path.join(PHASE3_EVIDENCE_DIR, '..', 'visual-v2', 'terrain-v2-qc.json');
  const terrainQc = JSON.parse(fs.readFileSync(terrainQcPath, 'utf8')) as {
    passed: boolean;
    seams: { horizontalMaxChannelDelta: number; verticalMaxChannelDelta: number; diagonalCornerMaxColorVariants: number };
    cliffs: { seams: { passed: boolean; horizontalMaxChannelDelta: number; verticalMaxChannelDelta: number } };
  };
  if (!terrainQc.passed || terrainQc.seams.horizontalMaxChannelDelta !== 0 || terrainQc.seams.verticalMaxChannelDelta !== 0 || terrainQc.seams.diagonalCornerMaxColorVariants !== 1) {
    fail('terrain visual seam QC is not clean');
  }
  if (!terrainQc.cliffs.seams.passed || terrainQc.cliffs.seams.horizontalMaxChannelDelta !== 0 || terrainQc.cliffs.seams.verticalMaxChannelDelta !== 0) fail('cliff visual seam QC is not clean');
  const result = {
    pass: true,
    geometry: { width: W, height: H, tileSize: 32 },
    wangMismatches,
    visualAssetVersion,
    mapDesignVersion,
    terrainAtlas: { tiles: tileset.tilecount, columns: tileset.columns, wangSchema: wangset.type, seamQc: terrainQc.seams },
    cliffAtlas: { tiles: cliffTileset.tilecount, authoredCells: authoredCliffCells, wangSchema: cliffWang.type, seamQc: terrainQc.cliffs.seams },
    terrainCounts,
    objectTypes: topology,
    openingInventory: { water: itemUnits.water_bottle + wreckUnits.waterUnits, food: itemUnits.food_ration + wreckUnits.foodUnits },
    springDistance,
    sourceHash,
  };
  fs.mkdirSync(PHASE3_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(PHASE3_EVIDENCE_DIR, 'source-validation.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) validatePhase3Map();
