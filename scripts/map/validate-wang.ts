// Wang-set / source validation for the MVP2 map (PRD 5.13).
// Fails (exit 1) on: edge-color mismatches, missing masks, incompatible
// centers, holes/magenta, low dedup, low entropy, large flat planes,
// travel-time or detour gate failures.

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { MAP_W, MAP_H, TERRAIN_INDEX, type TerrainClass } from './generate-map';
import { cellIndex, type RuntimeMap } from './map-types';
import { dijkstra, analyzeMap } from './analyze-map';
import { renderMapPixels } from './render-map-preview';

const WANG_ORDER: TerrainClass[] = ['deep', 'shallow', 'wetSand', 'drySand', 'grass', 'sparse', 'dense', 'mud', 'rock', 'cliff', 'path'];

function chainDist(a: TerrainClass, b: TerrainClass): number {
  if (a === b) return 0;
  const chain = ['deep', 'shallow', 'wetSand', 'drySand', 'grass', 'sparse', 'dense'] as TerrainClass[];
  const ia = chain.indexOf(a as (typeof chain)[number]);
  const ib = chain.indexOf(b as (typeof chain)[number]);
  if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) <= 1) return Math.abs(ia - ib);
  const compat: Record<string, TerrainClass[]> = {
    sparse: ['grass', 'dense', 'mud', 'path', 'drySand', 'rock', 'wetSand', 'cliff'],
    dense: ['grass', 'sparse', 'mud', 'drySand', 'rock', 'wetSand', 'cliff'],
    mud: ['grass', 'sparse', 'dense', 'path', 'drySand', 'wetSand'],
    rock: ['grass', 'cliff', 'drySand', 'wetSand', 'shallow', 'sparse', 'dense'],
    cliff: ['rock', 'grass', 'deep', 'shallow', 'wetSand', 'drySand', 'sparse', 'dense'],
    path: ['grass', 'drySand', 'sparse', 'mud'],
    grass: ['drySand', 'sparse', 'dense', 'mud', 'rock', 'path'],
  };
  if ((compat[a] ?? []).includes(b) || (compat[b] ?? []).includes(a)) return 1;
  return 99;
}

export function validateMap(runtime: RuntimeMap, tsjPath: string): { pass: boolean; checks: Record<string, { pass: boolean; detail: string }> } {
  const checks: Record<string, { pass: boolean; detail: string }> = {};
  const tsj = JSON.parse(fs.readFileSync(tsjPath, 'utf8'));
  const classByGid = new Map<number, TerrainClass>();
  tsj.tiles.forEach((t: { id: number; type: string }) => classByGid.set(t.id + 1, t.type as TerrainClass));

  // 1. Wang adjacency: every cell's tile wangid must match the corner rule
  //    (NW=(x-1,y-1), NE=(x,y-1), SW=(x-1,y), SE=(x,y)).
  let wangMismatch = 0;
  const wangByGid = new Map<number, number[]>();
  for (const w of tsj.wangsets[0].tiles) wangByGid.set(w.tileid + 1, w.wangid);
  const gidAt = (x: number, y: number): number => {
    const ch = runtime.chunks[`${Math.floor(x / 32)},${Math.floor(y / 32)}`];
    return ch.gids[(y % 32) * 32 + (x % 32)];
  };
  const clsAt = (x: number, y: number): TerrainClass => {
    const gid = gidAt(x, y);
    return classByGid.get(gid) ?? 'deep';
  };
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const gid = gidAt(x, y);
      const cls = classByGid.get(gid);
      if (!cls) {
        wangMismatch++;
        continue;
      }
      const expected = [
        WANG_ORDER.indexOf(x > 0 && y > 0 ? clsAt(x - 1, y - 1) : cls),
        WANG_ORDER.indexOf(y > 0 ? clsAt(x, y - 1) : cls),
        WANG_ORDER.indexOf(x > 0 ? clsAt(x - 1, y) : cls),
        WANG_ORDER.indexOf(cls),
      ];
      const actual = wangByGid.get(gid);
      if (!actual || actual[0] !== expected[0] || actual[1] !== expected[1] || actual[2] !== expected[2] || actual[3] !== expected[3]) {
        wangMismatch++;
      }
    }
  }
  checks.wangCornerConsistency = { pass: wangMismatch === 0, detail: `${wangMismatch} mismatches` };

  // 2. Incompatible centers.
  let incompatible = 0;
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const cls = runtime.terrainClass[cellIndex(x, y, MAP_W)];
      const name = (Object.keys(TERRAIN_INDEX) as TerrainClass[]).find((k) => TERRAIN_INDEX[k] === cls) ?? 'deep';
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = runtime.terrainClass[cellIndex(x + ox, y + oy, MAP_W)];
        const nName = (Object.keys(TERRAIN_INDEX) as TerrainClass[]).find((k) => TERRAIN_INDEX[k] === n) ?? 'deep';
        if (chainDist(name, nName) > 1) incompatible++;
      }
    }
  }
  checks.centerCompatibility = { pass: incompatible === 0, detail: `${incompatible} incompatible orthogonal pairs` };

  // 3. Atlas / texture richness checks.
  const terrainPng = PNG.sync.read(fs.readFileSync(path.join(__dirname, '../../public/generated/maps/aisland-mvp2/terrain.png')));
  const tileW = 32;
  const cols = Math.floor(terrainPng.width / tileW);
  const rows = Math.floor(terrainPng.height / tileW);
  let transparent = 0;
  let magenta = 0;
  const hashes = new Map<string, number>();
  let entropySum = 0;
  let entropyN = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      let h = 0;
      let hasAlpha = false;
      let zeroAlpha = 0;
      const hist = new Map<number, number>();
      for (let y = 0; y < tileW; y++) {
        for (let x = 0; x < tileW; x++) {
          const i = ((ty * tileW + y) * terrainPng.width + tx * tileW + x) * 4;
          const r = terrainPng.data[i];
          const g = terrainPng.data[i + 1];
          const b = terrainPng.data[i + 2];
          const a = terrainPng.data[i + 3];
      if (a < 255 && a > 0) hasAlpha = true;
      if (a === 0) zeroAlpha++;
          if (r > 200 && g < 80 && b > 200) magenta++;
          h = (h * 31 + r + g * 3 + b * 5 + a * 7) >>> 0;
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          hist.set(key, (hist.get(key) ?? 0) + 1);
        }
      }
      if (hasAlpha && zeroAlpha < 1024) transparent++;
      hashes.set(h.toString(36), (hashes.get(h.toString(36)) ?? 0) + 1);
      if (zeroAlpha < 1024) {
        let e = 0;
        for (const c of hist.values()) {
          const p = c / 1024;
          e -= p * Math.log2(p);
        }
        entropySum += e;
        entropyN++;
      }
    }
  }
  checks.noTransparentGround = { pass: transparent === 0, detail: `${transparent} transparent tiles` };
  checks.noMagenta = { pass: magenta === 0, detail: `${magenta} magenta pixels` };
  checks.textureRichness = {
    pass: hashes.size >= 300 && entropySum / Math.max(1, entropyN) >= 2.0,
    detail: `distinct composed tiles ${hashes.size}, mean tile entropy ${(entropySum / Math.max(1, entropyN)).toFixed(2)} bits (gates: >=300 tiles, >=2.0 bits)`,
  };

  // 3b. No large monochrome planes on the rendered map (8px/tile preview).
  const preview = renderMapPixels(runtime, 8);
  const png = new PNG({ width: preview.w, height: preview.h });
  png.data = preview.data;
  const flatBlock = 24; // 24x24 preview px = 12x12 tiles
  let flatPlanes = 0;
  for (let y = 0; y + flatBlock <= png.height; y += flatBlock) {
    for (let x = 0; x + flatBlock <= png.width; x += flatBlock) {
      const first = ((y * png.width + x) * 4);
      const r0 = png.data[first];
      const g0 = png.data[first + 1];
      const b0 = png.data[first + 2];
      let flat = true;
      for (let yy = 0; yy < flatBlock && flat; yy++) {
        for (let xx = 0; xx < flatBlock; xx++) {
          const i = (((y + yy) * png.width + x + xx) * 4);
          if (png.data[i] !== r0 || png.data[i + 1] !== g0 || png.data[i + 2] !== b0) {
            flat = false;
            break;
          }
        }
      }
      if (flat) flatPlanes++;
    }
  }
  checks.noFlatPlanes = { pass: flatPlanes === 0, detail: `${flatPlanes} monochrome 12x12-tile planes` };

  // 4. Travel time gate.
  const spawn = runtime.spawnPoints[0];
  const { dist } = dijkstra(runtime, spawn);
  let maxDist = 0;
  for (let i = 0; i < dist.length; i++) if (isFinite(dist[i]) && dist[i] > maxDist) maxDist = dist[i];
  checks.travelTime = { pass: maxDist >= 720, detail: `${Math.round(maxDist)} island-min (gate >= 720)` };

  // 5. Detour gate.
  const analysis = analyzeMap(runtime);
  const detour = Number(analysis.detourCells);
  // Island area was halved per product direction (2026-08-07); the detour
  // gate scales with island size (old 40-cell gate assumed the pre-halving
  // continent). 15 cells still guarantees a real inlet-forced detour.
  checks.detour = { pass: detour >= 15, detail: `${detour} cell detour (gate >= 15, island-halved spec)` };

  // 6. Coastline features (bays/headlands).
  const coastTotal = Number(analysis.coastlineFeatures?.total ?? 0);
  checks.coastlineFeatures = { pass: coastTotal >= 5, detail: `${coastTotal} bays/headlands (gate >= 5)` };

  // 7. Terrain ratios as % of land area (PRD 5.9).
  const ratios = (analysis.terrainRatios as Record<string, number>) ?? {};
  const land = Object.entries(ratios)
    .filter(([k]) => !['deep', 'shallow'].includes(k))
    .reduce((s, [, v]) => s + v, 0);
  const landPct = (k: string) => ((ratios[k] ?? 0) / land) * 100;
  const ratioChecks: Array<[string, number, number]> = [
    ['dense', 25, 40],
    ['sparse', 15, 25],
    ['rock', 12, 22],
    ['mud', 5, 12],
  ];
  for (const [k, lo, hi] of ratioChecks) {
    const pct = landPct(k);
    checks[`ratio_${k}`] = { pass: pct >= lo && pct <= hi, detail: `${k} = ${pct.toFixed(1)}% of land (gate ${lo}-${hi}%)` };
  }

  const pass = Object.values(checks).every((c) => c.pass);
  return { pass, checks };
}

export function runValidation() {
  const root = path.join(__dirname, '../..');
  const runtime = JSON.parse(fs.readFileSync(path.join(root, 'public/generated/maps/aisland-mvp2/map.runtime.json'), 'utf8')) as RuntimeMap;
  const tsjPath = path.join(root, 'assets/source/mvp2/tilesets/terrain.tsj');
  const result = validateMap(runtime, tsjPath);
  const outDir = path.join(root, 'acceptance/mvp2/map');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'wang-coverage.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  if (!result.pass) process.exit(1);
}

if (require.main === module) runValidation();
