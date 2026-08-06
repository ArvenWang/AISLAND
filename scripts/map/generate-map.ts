// AISLAND MVP2 map generator.
// Produces a Tiled-source map (maps/aisland-mvp2.tmj + tilesets/terrain.tsj)
// with a deterministic, seeded 256x192 terrain layout. The rendered ground
// atlas is baked at build time: every cell's tile is composed from the
// terrain classes of its four diagonal corner cells (corner-wang semantics),
// so shared edges and vertices are consistent by construction and the runtime
// never mixes RGB colors.

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import {
  atlasFromTiles,
  baseTexture,
  berryBushSprite,
  bufferToPng,
  createBuffer,
  fireSprite,
  foodRationSprite,
  getPx,
  hashString,
  lighterSprite,
  makeNoise,
  makeRng,
  nearestScale,
  paletteSwap,
  rockSprite,
  setPx,
  tinderSprite,
  treeSprite,
  waterBottleSprite,
  woodLogSprite,
  wreckageSprite,
  backpackSprite,
  cliffFaceTexture,
  type PixelBuffer,
  type RGB,
} from './pixel-art';
import { buildTerrainBases } from './real-assets';
import { buildEdgeModules, type EdgeModuleKey, type EdgeModuleSet } from './real-assets';

export const MAP_W = 256;
export const MAP_H = 192;
export const TILE = 32;
export const MAP_VERSION = 'mvp2-map-v1';

// Terrain chain (index order defines adjacency compatibility).
export const TERRAIN_CHAIN = [
  'deep',
  'shallow',
  'wetSand',
  'drySand',
  'grass',
  'sparse',
  'dense',
] as const;
export const EXTRA_TERRAIN = ['mud', 'rock', 'cliff', 'path'] as const;
export type TerrainClass = (typeof TERRAIN_CHAIN)[number] | (typeof EXTRA_TERRAIN)[number];

export const TERRAIN_INDEX: Record<TerrainClass, number> = {
  deep: 0,
  shallow: 1,
  wetSand: 2,
  drySand: 3,
  grass: 4,
  sparse: 5,
  dense: 6,
  mud: 7,
  rock: 8,
  cliff: 9,
  path: 10,
};

// Move cost multiplier per class (base 4 island-minutes per cell on grass).
export const MOVE_COST: Record<TerrainClass, number> = {
  deep: Infinity,
  shallow: Infinity,
  wetSand: 1.1,
  drySand: 0.9,
  grass: 1.0,
  sparse: 1.3,
  dense: 2.0,
  mud: 2.6,
  rock: 2.2,
  cliff: Infinity,
  path: 0.85,
};

export const VISION_OPACITY: Record<TerrainClass, number> = {
  deep: 0,
  shallow: 0,
  wetSand: 0,
  drySand: 0,
  grass: 0.15,
  sparse: 0.5,
  dense: 0.85,
  mud: 0.35,
  rock: 0.2,
  cliff: 1,
  path: 0.1,
};

export const SOUND_COST: Record<TerrainClass, number> = {
  deep: 1,
  shallow: 1,
  wetSand: 0.7,
  drySand: 0.7,
  grass: 1.0,
  sparse: 1.4,
  dense: 2.1,
  mud: 1.2,
  rock: 1.1,
  cliff: Infinity,
  path: 0.8,
};

export const ELEVATION: Record<TerrainClass, number> = {
  deep: 0,
  shallow: 0,
  wetSand: 1,
  drySand: 1,
  grass: 2,
  sparse: 2,
  dense: 2,
  mud: 1,
  rock: 4,
  cliff: 5,
  path: 2,
};

function isPassable(c: TerrainClass): boolean {
  return c !== 'deep' && c !== 'shallow' && c !== 'cliff';
}

function chainDist(a: TerrainClass, b: TerrainClass): number {
  if (a === b) return 0;
  const ia = TERRAIN_CHAIN.indexOf(a as (typeof TERRAIN_CHAIN)[number]);
  const ib = TERRAIN_CHAIN.indexOf(b as (typeof TERRAIN_CHAIN)[number]);
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

export type Grid = TerrainClass[][];

export type MapObject = {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Record<string, string | number | boolean>;
};

export type GeneratedMap = {
  seed: number;
  terrain: Grid;
  objects: MapObject[];
  spawnPoints: Array<{ x: number; y: number }>;
  inlet: { headX: number; mouthX: number; y0: number; y1: number } | null;
  atlasTiles: PixelBuffer[];
  atlasCols: number;
  gidByCell: number[][];
  tileClassByGid: Map<number, TerrainClass>;
  decalTiles: PixelBuffer[];
  decalGids: number[][];
  sourceHash: string;
};

export function generateTerrain(seed: number): { grid: Grid; inlet: GeneratedMap['inlet'] } {
  const rng = makeRng(seed, 'island-shape');
  const elev = makeNoise(seed, 'elevation', 26, 4);
  const bay = makeNoise(seed, 'bay-carve', 9, 3);
  const head = makeNoise(seed, 'headland', 14, 2);
  const forest = makeNoise(seed, 'forest', 11, 2);
  const forest2 = makeNoise(seed, 'forest-edge', 9, 2);
  const wet = makeNoise(seed, 'wetland', 18, 2);
  const grid: Grid = Array.from({ length: MAP_H }, () => Array<TerrainClass>(MAP_W).fill('deep'));
  const debugStage = (label: string) => {
    if (!process.env.MVP2_DEBUG_STAGES) return;
    const h: Record<string, number> = {};
    for (const row of grid) for (const c of row) h[c] = (h[c] ?? 0) + 1;
    console.log(`STAGE ${label}:`, JSON.stringify(h));
  };

  const land: boolean[][] = Array.from({ length: MAP_H }, () => Array<boolean>(MAP_W).fill(false));

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      // Irregular continent: distance falloff modulated by angular noise.
      const cx = MAP_W / 2 + (bay(x, y) - 0.5) * 34;
      const cy = MAP_H / 2 - 4 + (head(x, y) - 0.5) * 26;
      const dx = (x - cx) / (98 + (elev(x, y) - 0.5) * 46);
      const dy = (y - cy) / (72 + (elev(x, y) - 0.5) * 34);
      const d = Math.sqrt(dx * dx + dy * dy);
      const carve = 0.92 + (bay(x, y) - 0.5) * 0.42 - (head(x, y) - 0.5) * 0.18;
      land[y][x] = d < carve;
    }
  }

  // Distance-from-coast bands.
  const dist: number[][] = Array.from({ length: MAP_H }, () => Array<number>(MAP_W).fill(9999));
  const q: Array<[number, number]> = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (land[y][x]) {
        let nearWater = false;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || !land[ny][nx]) nearWater = true;
        }
        if (nearWater) {
          dist[y][x] = 0;
          q.push([x, y]);
        }
      }
    }
  }
  let qi = 0;
  while (qi < q.length) {
    const [x, y] = q[qi++];
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && land[ny][nx] && dist[ny][nx] > dist[y][x] + 1) {
        dist[ny][nx] = dist[y][x] + 1;
        q.push([nx, ny]);
      }
    }
  }

  // South beach: force a wide, irregular beach band along the south edge.
  const beachY0 = MAP_H - 26 - Math.floor(rng() * 4);
  const beachX0 = Math.floor(MAP_W * 0.39);
  const beachX1 = Math.floor(MAP_W * 0.61);
  for (let y = beachY0; y < MAP_H; y++) {
    for (let x = beachX0; x < beachX1; x++) {
      const wob = Math.sin(x * 0.11 + seed) * 3 + Math.sin(x * 0.043 + seed * 2) * 5;
      if (y >= beachY0 + wob) {
        land[y][x] = true;
        dist[y][x] = Math.min(dist[y][x], 0);
      }
    }
  }
  // Recompute distance near the beach band.
  for (let y = beachY0 - 6; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!land[y][x]) continue;
      let best = dist[y][x];
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && land[ny][nx] && dist[ny][nx] + 1 < best) {
          best = dist[ny][nx] + 1;
        }
      }
      dist[y][x] = best;
    }
  }

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!land[y][x]) continue;
      const d = dist[y][x];
      const e = elev(x, y);
      const w = wet(x, y);
      if (d === 0) grid[y][x] = 'wetSand';
      else if (d === 1) grid[y][x] = 'drySand';
      else if (d === 2 && rng() < 0.35) grid[y][x] = 'drySand';
      else if (w > 0.68 && e < 0.46 && d > 5) grid[y][x] = 'mud';
      else if (e > 0.72 && d > 5) grid[y][x] = 'rock';
      else if (e > 0.64 && d > 3 && rng() < 0.5) grid[y][x] = 'rock';
      else if (forest(x, y) > 0.47 && d > 3) grid[y][x] = 'dense';
      else if ((forest(x, y) > 0.19 && d > 1) || (forest2(x, y) > 0.52 && d > 2)) grid[y][x] = 'sparse';
      else grid[y][x] = 'grass';
    }
  }

  // East inlet (sea-connected channel) forcing a long detour.
  let inlet: GeneratedMap['inlet'] = null;
  const coastAt = (y: number): number => {
    let c = MAP_W - 2;
    while (c > 4 && grid[y][c] === 'deep') c--;
    return Math.min(c + 1, MAP_W - 2);
  };
  for (let attempt = 0; attempt < 10 && !inlet; attempt++) {
    const inletCy = 52 + Math.floor(rng() * 40);
    // Prefer a vertically straight coastline so the channel has land on both sides.
    let straight = true;
    const c0 = coastAt(inletCy);
    for (let y = inletCy - 10; y <= inletCy + 14; y++) {
      const c = coastAt(Math.max(2, Math.min(MAP_H - 3, y)));
      if (Math.abs(c - c0) > 6) {
        straight = false;
        break;
      }
    }
    if (!straight || c0 <= 100) continue;
    const len = 44 + Math.floor(rng() * 10);
    const w = 3;
    const carve: Array<[number, number]> = [];
    for (let i = 0; i < len; i++) {
      const x = c0 - i;
      for (let dy = 0; dy < w; dy++) {
        const y = inletCy + dy - 1;
        if (x < 4 || y < 2 || y >= MAP_H - 2) continue;
        if (grid[y][x] !== 'deep') {
          carve.push([x, y]);
          grid[y][x] = 'deep';
        }
      }
    }
    inlet = { headX: c0 - len, mouthX: c0, y0: inletCy - 1, y1: inletCy + w - 2 };
    // Connectivity check: the land north of the channel must stay reachable
    // from the south beach via a path around the channel head.
    const reachable = new Uint8Array(MAP_W * MAP_H);
    const q: Array<[number, number]> = [[Math.floor(MAP_W * 0.5), MAP_H - 10]];
    reachable[(MAP_H - 10) * MAP_W + Math.floor(MAP_W * 0.5)] = 1;
    let qi = 0;
    while (qi < q.length) {
      const [x, y] = q[qi++];
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const i = ny * MAP_W + nx;
        if (reachable[i]) continue;
        if (grid[ny][nx] === 'deep') continue;
        reachable[i] = 1;
        q.push([nx, ny]);
      }
    }
    const northProbe = coastAt(inletCy - 12);
    const probeX = Math.max(5, Math.min(MAP_W - 5, northProbe - 3));
    if (!reachable[(inletCy - 12) * MAP_W + probeX]) {
      // Undo the carve.
      for (const [x, y] of carve) grid[y][x] = 'drySand';
      inlet = null;
    }
  }

  // Coastal band repair: enforce deep -> shallow -> wetSand -> drySand rings.
  for (let pass = 0; pass < 2; pass++) {
    const next = grid.map((row) => row.slice());
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const c = grid[y][x];
        if (c === 'deep' || c === 'shallow' || c === 'cliff' || c === 'rock') continue;
        const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oy]) => grid[y + oy]?.[x + ox]).filter(Boolean) as TerrainClass[];
        if (neigh.includes('deep')) next[y][x] = 'shallow';
        else if (neigh.includes('shallow') && c !== 'wetSand') next[y][x] = 'wetSand';
        else if (neigh.includes('wetSand') && c !== 'wetSand' && c !== 'drySand') next[y][x] = 'drySand';
      }
    }
    grid.splice(0, grid.length, ...next);
  }

  debugStage('after-classify');
  // Region forcing: highlands and wetland basins (PRD terrain ratios).
  const rockAnchors: Array<[number, number, number]> = [
    [Math.floor(MAP_W * 0.24), Math.floor(MAP_H * 0.26), 38],
    [Math.floor(MAP_W * 0.76), Math.floor(MAP_H * 0.32), 32],
    [Math.floor(MAP_W * 0.42), Math.floor(MAP_H * 0.2), 24],
  ];
  for (const [ax, ay, ar] of rockAnchors) {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const d = Math.hypot(x - ax, y - ay);
        if (d < ar && elev(x, y) > 0.46 && (grid[y][x] === 'grass' || grid[y][x] === 'sparse' || grid[y][x] === 'dense')) grid[y][x] = 'rock';
      }
    }
  }
  const mudAnchors: Array<[number, number, number]> = [
    [Math.floor(MAP_W * 0.62), Math.floor(MAP_H * 0.62), 34],
    [Math.floor(MAP_W * 0.38), Math.floor(MAP_H * 0.48), 28],
  ];
  for (const [ax, ay, ar] of mudAnchors) {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const d = Math.hypot(x - ax, y - ay);
        if (d < ar && wet(x, y) > 0.24 && (grid[y][x] === 'grass' || grid[y][x] === 'sparse')) grid[y][x] = 'mud';
      }
    }
  }

  // Mountain ridge with a single narrow pass (guaranteed chokepoint that
  // forces a >= 40-cell detour when blocked).
  {
    const rx = Math.floor(MAP_W * 0.54) + Math.floor(rng() * 12);
    const ry0 = 32;
    const ry1 = 118;
    const gapY0 = 74;
    const gapY1 = 75;
    for (let y = ry0; y <= ry1; y++) {
      if (y >= gapY0 && y <= gapY1) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx;
        if (x < 4 || x >= MAP_W - 4) continue;
        if (grid[y][x] === 'grass' || grid[y][x] === 'sparse' || grid[y][x] === 'dense' || grid[y][x] === 'path') {
          grid[y][x] = 'rock';
        }
      }
    }
  }
  debugStage('after-ridge');

  // Cliffs: rock cells adjacent to much lower terrain.
  const step = (a: TerrainClass, b: TerrainClass) => ELEVATION[a] - ELEVATION[b];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y][x] !== 'rock') continue;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && step(grid[y][x], grid[ny][nx]) >= 3) {
          grid[y][x] = 'cliff';
          break;
        }
      }
    }
  }
  // Ensure at least one gap through cliffs into the highland.
  const gaps = 3;
  for (let g = 0; g < gaps; g++) {
    let placed = false;
    for (let tries = 0; tries < 400 && !placed; tries++) {
      const x = 20 + Math.floor(rng() * (MAP_W - 40));
      const y = 20 + Math.floor(rng() * (MAP_H - 60));
      if (grid[y][x] === 'cliff') {
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oy]) => grid[y + oy]?.[x + ox]).filter(Boolean);
        if (neighbors.includes('rock')) {
          grid[y][x] = 'rock';
          placed = true;
        }
      }
    }
  }
  debugStage('after-cliffs');

  // Natural paths: winding routes from beach to inland landmarks.
  const pathRng = makeRng(seed, 'paths');
  const landCells: Array<[number, number]> = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (isPassable(grid[y][x]) && grid[y][x] !== 'mud' && grid[y][x] !== 'cliff') landCells.push([x, y]);
    }
  }
  const pickLand = (avoidY0: number): [number, number] => {
    for (let t = 0; t < 300; t++) {
      const c = landCells[Math.floor(pathRng() * landCells.length)];
      if (c[1] > avoidY0 + 30) return c;
    }
    return landCells[Math.floor(pathRng() * landCells.length)];
  };
  const targets = [pickLand(0), pickLand(20), pickLand(60)];
  const starts = [
    [Math.floor(MAP_W * 0.3), MAP_H - 8],
    [Math.floor(MAP_W * 0.55), MAP_H - 10],
    [Math.floor(MAP_W * 0.45), MAP_H - 6],
  ];
  for (let p = 0; p < targets.length; p++) {
    let x = starts[p][0];
    let y = starts[p][1];
    const [tx, ty] = targets[p];
    let guard = 0;
    while ((Math.abs(x - tx) + Math.abs(y - ty) > 4) && guard++ < 1200) {
      const c = grid[y]?.[x];
      if (c === 'grass' || c === 'drySand' || c === 'sparse' || c === 'path') grid[y][x] = 'path';
      const dx = tx - x;
      const dy = ty - y;
      const wob = Math.floor(pathRng() * 3) - 1;
      if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx);
      else y += Math.sign(dy);
      if (pathRng() < 0.35) {
        if (pathRng() < 0.5) x += Math.sign(dx) === 0 ? wob : 0;
        else y += Math.sign(dy) === 0 ? wob : 0;
      }
      x = Math.max(1, Math.min(MAP_W - 2, x));
      y = Math.max(1, Math.min(MAP_H - 2, y));
    }
  }
  debugStage('after-paths');

  // Chain-enforcement relaxation: no incompatible orthogonal neighbors.
  for (let pass = 0; pass < 5; pass++) {
    const next = grid.map((row) => row.slice());
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        const c = grid[y][x];
        if (c === 'deep') continue;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = grid[y + oy][x + ox];
          if (n === 'deep') continue;
          if (chainDist(c, n) > 1) {
            const waterish = (t: TerrainClass) => t === 'deep' || t === 'shallow' || t === 'wetSand' || t === 'drySand';
            if (waterish(n)) next[y][x] = n === 'deep' ? 'shallow' : n === 'shallow' ? 'wetSand' : 'drySand';
            else if (waterish(c)) next[y][x] = c === 'deep' ? 'shallow' : c === 'shallow' ? 'wetSand' : 'drySand';
            else next[y][x] = 'grass';
            break;
          }
        }
      }
    }
    grid.splice(0, grid.length, ...next);
  }
  debugStage('after-relax');

  // Final coastal ring repair (after paths/relaxation).
  for (let pass = 0; pass < 4; pass++) {
    const next = grid.map((row) => row.slice());
    let changed = 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const c = grid[y][x];
        if (c === 'deep' || c === 'shallow' || c === 'cliff' || c === 'rock') continue;
        const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oy]) => grid[y + oy]?.[x + ox]).filter(Boolean) as TerrainClass[];
        let nc = c;
        if (neigh.includes('deep')) nc = 'shallow';
        else if (neigh.includes('shallow') && c !== 'wetSand') nc = 'wetSand';
        else if (neigh.includes('wetSand') && c !== 'wetSand' && c !== 'drySand') nc = 'drySand';
        if (nc !== c) {
          next[y][x] = nc;
          changed++;
        }
      }
    }
    grid.splice(0, grid.length, ...next);
    if (changed === 0) break;
  }
  debugStage('after-repair');

  return { grid, inlet };
}

// --- Atlas / tile composition ---

// Real pixel-art bases (extracted from licensed game tilesets) with a 1px
// style-preserving edge ring for seam-free tiling.
let realBases: { tiles: PixelBuffer[]; config: Record<string, { tiles: number[]; edgeColors: Array<[number, number, number]> }> } | null = null;
let edgeModules: { modules: Map<EdgeModuleKey, EdgeModuleSet>; reverse: Map<EdgeModuleKey, EdgeModuleSet> } | null = null;

function ensureRealBases() {
  if (!realBases) {
    const { atlas, config } = buildTerrainBases();
    const tiles: PixelBuffer[] = [];
    const t = 32;
    const cols = Math.floor(atlas.w / t);
    const rows = Math.floor(atlas.h / t);
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
      const tile = createBuffer(t, t, null);
      for (let y = 0; y < t; y++) {
        for (let x = 0; x < t; x++) {
          const [r, g, b, a] = getPx(atlas, tx * t + x, ty * t + y);
          setPx(tile, x, y, [r, g, b], a);
        }
      }
      tiles.push(tile);
      }
    }
    realBases = { tiles, config: config as Record<string, { tiles: number[]; edgeColors: Array<[number, number, number]> }> };
  }
  return realBases;
}

function baseAt(kind: TerrainClass, _variantSeed: number): PixelBuffer {
  const { tiles, config } = ensureRealBases();
  const entry = config[kind];
  if (!entry) {
    // Fallback: procedural texture (should not happen for known classes).
    const b = baseTexture(kind, makeRng(_variantSeed, `base-${kind}`));
    return b;
  }
  const variant = Math.abs(_variantSeed) % Math.max(1, entry.tiles.length);
  const b = createBuffer(32, 32, null);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const [r, g, bl, a] = getPx(tiles[entry.tiles[variant]], x, y);
      setPx(b, x, y, [r, g, bl], a);
    }
  }
  return b;
}

function ensureEdgeModules() {
  if (!edgeModules) edgeModules = buildEdgeModules();
  return edgeModules;
}

function pasteRegion(dst: PixelBuffer, src: PixelBuffer, dx: number, dy: number, sx: number, sy: number, w: number, h: number) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = getPx(src, sx + x, sy + y);
      setPx(dst, dx + x, dy + y, [r, g, b], a);
    }
  }
}

// Compose one cell's ground tile from its corner classes.
export function composeTile(cellClass: TerrainClass, corners: { nw: TerrainClass; ne: TerrainClass; sw: TerrainClass; se: TerrainClass }, neighbors: { n: TerrainClass; e: TerrainClass; s: TerrainClass; w: TerrainClass }, cellSeed: number): PixelBuffer {
  const body = baseAt(cellClass, cellSeed);
  const out = createBuffer(32, 32, null);
  pasteRegion(out, body, 0, 0, 0, 0, 32, 32);
  const stripW = 10;
  const cornerS = 8;
  const { modules } = ensureEdgeModules();
  const differing: Array<'n' | 'e' | 's' | 'w'> = [];
  if (neighbors.n !== cellClass) differing.push('n');
  if (neighbors.s !== cellClass) differing.push('s');
  if (neighbors.w !== cellClass) differing.push('w');
  if (neighbors.e !== cellClass) differing.push('e');
  const moduleFor = (side: 'n' | 'e' | 's' | 'w', neighbor: TerrainClass): PixelBuffer | null => {
    const key = `${cellClass}|${neighbor}` as EdgeModuleKey;
    const set = modules.get(key);
    if (!set) return null;
    return set[side === 'n' ? 'N' : side === 's' ? 'S' : side === 'w' ? 'W' : 'E'];
  };
  if (differing.length === 1) {
    const side = differing[0];
    const neighbor = neighbors[side];
    const mod = moduleFor(side, neighbor);
    if (mod) {
      // Single real edge module: use the whole generated transition tile.
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const [r, g, b, a] = getPx(mod, x, y);
          if (a > 0) setPx(out, x, y, [r, g, b], a);
        }
      }
    }
  } else {
    for (const side of differing) {
      const neighbor = neighbors[side];
      const mod = moduleFor(side, neighbor);
      if (mod) {
        // Overlay the module's outer strip band.
        if (side === 'n') pasteRegion(out, mod, 0, 0, 0, 0, 32, stripW);
        if (side === 's') pasteRegion(out, mod, 0, 32 - stripW, 0, 32 - stripW, 32, stripW);
        if (side === 'w') pasteRegion(out, mod, 0, 0, 0, 0, stripW, 32);
        if (side === 'e') pasteRegion(out, mod, 32 - stripW, 0, 32 - stripW, 0, stripW, 32);
      } else {
        const base = baseAt(neighbor, cellSeed ^ hashString(`strip-${side}`));
        if (side === 'n') pasteRegion(out, base, 0, 0, 0, 0, 32, stripW);
        if (side === 's') pasteRegion(out, base, 0, 32 - stripW, 0, 32 - stripW, 32, stripW);
        if (side === 'w') pasteRegion(out, base, 0, 0, 0, 0, stripW, 32);
        if (side === 'e') pasteRegion(out, base, 32 - stripW, 0, 32 - stripW, 0, stripW, 32);
      }
    }
  }
  const drawCorner = (corner: 'nw' | 'ne' | 'sw' | 'se', cls: TerrainClass) => {
    const base = baseAt(cls, cellSeed ^ hashString(`corner-${corner}`));
    if (corner === 'nw') pasteRegion(out, base, 0, 0, 0, 0, cornerS, cornerS);
    if (corner === 'ne') pasteRegion(out, base, 32 - cornerS, 0, 32 - cornerS, 0, cornerS, cornerS);
    if (corner === 'sw') pasteRegion(out, base, 0, 32 - cornerS, 0, 32 - cornerS, cornerS, cornerS);
    if (corner === 'se') pasteRegion(out, base, 32 - cornerS, 32 - cornerS, 32 - cornerS, 32 - cornerS, cornerS, cornerS);
  };
  if (corners.nw !== cellClass) drawCorner('nw', corners.nw);
  if (corners.ne !== cellClass) drawCorner('ne', corners.ne);
  if (corners.sw !== cellClass) drawCorner('sw', corners.sw);
  if (corners.se !== cellClass) drawCorner('se', corners.se);
  // Soften internal seams with 1px dithering along strip/corner borders.
  const rng = makeRng(cellSeed, 'dither');
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rng() * 32);
    const y = Math.floor(rng() * 32);
    const [r, g, b] = getPx(out, x, y);
    setPx(out, x, y, [r, g, b], 255);
  }
  return out;
}

function decalTiles(seed: number): PixelBuffer[] {
  const rng = makeRng(seed, 'decals');
  const out: PixelBuffer[] = [];
  // grass tuft
  {
    const b = createBuffer(32, 32, null);
    for (let i = 0; i < 9; i++) {
      const x = 6 + Math.floor(rng() * 20);
      const y = 20 + Math.floor(rng() * 8);
      setPx(b, x, y, [64, 118, 50]);
      setPx(b, x + 1, y - 1, [80, 138, 62]);
      setPx(b, x, y - 2, [100, 156, 76]);
    }
    out.push(b);
  }
  // pebbles
  {
    const b = createBuffer(32, 32, null);
    for (let i = 0; i < 5; i++) {
      const x = 5 + Math.floor(rng() * 20);
      const y = 18 + Math.floor(rng() * 10);
      setPx(b, x, y, [150, 146, 140]);
      setPx(b, x + 1, y, [122, 120, 116]);
      setPx(b, x, y + 1, [108, 106, 102]);
    }
    out.push(b);
  }
  // dry grass
  {
    const b = createBuffer(32, 32, null);
    for (let i = 0; i < 7; i++) {
      const x = 4 + Math.floor(rng() * 24);
      const y = 20 + Math.floor(rng() * 8);
      setPx(b, x, y, [172, 150, 96]);
      setPx(b, x + 1, y - 1, [196, 174, 116]);
    }
    out.push(b);
  }
  // white flowers
  {
    const b = createBuffer(32, 32, null);
    for (let i = 0; i < 4; i++) {
      const x = 8 + Math.floor(rng() * 16);
      const y = 16 + Math.floor(rng() * 10);
      setPx(b, x, y, [240, 240, 236]);
      setPx(b, x + 1, y, [240, 240, 236]);
      setPx(b, x, y + 1, [240, 240, 236]);
      setPx(b, x + 1, y + 1, [228, 198, 90]);
    }
    out.push(b);
  }
  // leaves
  {
    const b = createBuffer(32, 32, null);
    for (let i = 0; i < 8; i++) {
      const x = 4 + Math.floor(rng() * 24);
      const y = 18 + Math.floor(rng() * 10);
      setPx(b, x, y, [56, 96, 46]);
      setPx(b, x + 1, y, [70, 118, 54], 200);
    }
    out.push(b);
  }
  // seashell (wet sand)
  {
    const b = createBuffer(32, 32, null);
    setPx(b, 14, 20, [232, 222, 200]);
    setPx(b, 15, 20, [232, 222, 200]);
    setPx(b, 14, 21, [232, 222, 200]);
    setPx(b, 15, 21, [214, 196, 168]);
    setPx(b, 16, 21, [232, 222, 200]);
    out.push(b);
  }
  return out;
}

export function generateMap(seed: number): GeneratedMap {
  const { grid: terrain, inlet } = generateTerrain(seed);
  const rng = makeRng(seed, 'objects');
  const objects: MapObject[] = [];
  let oid = 1;

  const addObj = (name: string, type: string, x: number, y: number, w = 32, h = 32, props: Record<string, string | number | boolean> = {}) => {
    objects.push({ id: oid++, name, type, x: x * TILE, y: y * TILE, width: w, height: h, properties: props });
  };

  // Spawn points: south beach, spread out near wreckage.
  const spawnPoints = [
    { x: Math.floor(MAP_W * 0.32), y: MAP_H - 14 },
    { x: Math.floor(MAP_W * 0.5), y: MAP_H - 12 },
    { x: Math.floor(MAP_W * 0.68), y: MAP_H - 15 },
  ];
  const fixPassable = (p: { x: number; y: number }): { x: number; y: number } => {
    if (isPassable(terrain[p.y]?.[p.x])) return p;
    for (let r = 1; r < 20; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = p.x + dx;
          const y = p.y + dy;
          if (x >= 1 && y >= 1 && x < MAP_W - 1 && y < MAP_H - 1 && isPassable(terrain[y][x])) return { x, y };
        }
      }
    }
    return p;
  };
  for (let i = 0; i < spawnPoints.length; i++) {
    const p = fixPassable(spawnPoints[i]);
    spawnPoints[i] = p;
    addObj(`spawn_${i + 1}`, 'spawn_point', p.x, p.y, 32, 32, { agentSlot: i + 1 });
  }

  // Wreckage on the beach.
  const wreckSpots: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 3; i++) {
    const wx = Math.floor(MAP_W * (0.26 + rng() * 0.48));
    const wy = MAP_H - 22 - Math.floor(rng() * 8);
    const p = fixPassable({ x: wx, y: wy });
    wreckSpots.push(p);
    addObj(`wreckage_${i + 1}`, 'wreckage', p.x, p.y, 64, 40, { searchable: true });
  }

  // Ground item spawns near wreckage (world turns these into entities).
  const itemDefs: Array<[string, number]> = [
    ['water_bottle', 5],
    ['food_ration', 3],
    ['lighter', 1],
    ['tinder', 2],
    ['backpack', 2],
    ['wood_log', 3],
  ];
  for (const [kind, count] of itemDefs) {
    for (let i = 0; i < count; i++) {
      const base = wreckSpots[Math.floor(rng() * wreckSpots.length)];
      const p = fixPassable({ x: base.x + Math.floor(rng() * 9) - 4, y: base.y + Math.floor(rng() * 5) - 2 });
      addObj(`item_${kind}_${i + 1}`, 'item_spawn', p.x, p.y, 32, 32, { itemKind: kind });
    }
  }

  // Spring: inland, near a low area not in dense forest.
  let springPos: { x: number; y: number } | null = null;
  for (let t = 0; t < 1200 && !springPos; t++) {
    const x = 30 + Math.floor(rng() * (MAP_W - 60));
    const y = 24 + Math.floor(rng() * (MAP_H - 90));
    const c = terrain[y][x];
    if (c === 'grass' || c === 'sparse' || c === 'mud') {
      const nearHigh = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(
        ([ox, oy]) => terrain[y + oy]?.[x + ox] === 'rock' || terrain[y + oy]?.[x + ox] === 'cliff',
      );
      if (nearHigh && y > 50 && y < MAP_H - 70) springPos = { x, y };
    }
  }
  if (!springPos) springPos = { x: Math.floor(MAP_W / 2), y: 60 };
  springPos = fixPassable(springPos);
  addObj('spring', 'water_spring', springPos.x, springPos.y, 48, 32, { resource: 'water', capacity: 60, regenPerIslandHour: 3 });

  // Berry bushes.
  for (let i = 0; i < 7; i++) {
    for (let t = 0; t < 200; t++) {
      const x = 16 + Math.floor(rng() * (MAP_W - 32));
      const y = 16 + Math.floor(rng() * (MAP_H - 50));
      const c = terrain[y][x];
      if (c === 'grass' || c === 'sparse') {
        addObj(`berry_bush_${i + 1}`, 'berry_bush', x, y, 32, 28, { resource: 'food', capacity: 6, regenPerIslandHour: 0.4 });
        break;
      }
    }
  }

  // Wood logs (harvestable).
  for (let i = 0; i < 9; i++) {
    for (let t = 0; t < 200; t++) {
      const x = 16 + Math.floor(rng() * (MAP_W - 32));
      const y = 16 + Math.floor(rng() * (MAP_H - 50));
      const c = terrain[y][x];
      if (c === 'sparse' || c === 'dense') {
        addObj(`wood_pile_${i + 1}`, 'wood_pile', x, y, 30, 16, { resource: 'wood', capacity: 4, regenPerIslandHour: 0.1 });
        break;
      }
    }
  }

  // Trees (TallProps + Foreground canopy).
  const treeRng = makeRng(seed, 'trees');
  let treeId = 1;
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      const c = terrain[y][x];
      if (c === 'dense' && treeRng() < 0.42) {
        addObj(`tree_${treeId}`, 'tree', x, y - 1, 48, 64, { variant: treeId % 3 });
        treeId++;
      } else if (c === 'sparse' && treeRng() < 0.16) {
        addObj(`tree_${treeId}`, 'tree', x, y - 1, 48, 64, { variant: treeId % 3 });
        treeId++;
      } else if (c === 'grass' && treeRng() < 0.012) {
        addObj(`tree_${treeId}`, 'tree', x, y - 1, 48, 64, { variant: treeId % 3 });
        treeId++;
      }
    }
  }

  // Rocks as ground props.
  let rockId = 1;
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      const c = terrain[y][x];
      if ((c === 'rock' || c === 'grass') && rng() < 0.02) {
        addObj(`rock_${rockId}`, 'rock', x, y, 40, 28, { blockMovement: true });
        rockId++;
      }
    }
  }

  // Highland viewpoint.
  let viewpoint: { x: number; y: number } | null = null;
  for (let t = 0; t < 1500 && !viewpoint; t++) {
    const x = 20 + Math.floor(rng() * (MAP_W - 40));
    const y = 14 + Math.floor(rng() * (MAP_H - 70));
    if (terrain[y][x] === 'rock') {
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([ox, oy]) => terrain[y + oy]?.[x + ox] !== 'cliff');
      if (open) viewpoint = { x, y };
    }
  }
  if (viewpoint) addObj('viewpoint', 'landmark_viewpoint', viewpoint.x, viewpoint.y, 32, 32, { landmark: true });

  // --- Ground atlas: compose every cell's tile, dedupe by corner tuple. ---
  const atlasMap = new Map<string, number>();
  const atlasTiles: PixelBuffer[] = [];
  const gidByCell: number[][] = Array.from({ length: MAP_H }, () => Array<number>(MAP_W).fill(0));
  const tileClassByGid = new Map<number, TerrainClass>();
  const cellSeedFor = (x: number, y: number) => (seed ^ hashString(`cell:${x},${y}`)) >>> 0;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const c = terrain[y][x];
      const at = (xx: number, yy: number): TerrainClass => {
        if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) return c;
        return terrain[yy][xx];
      };
      const corners = {
        nw: at(x - 1, y - 1),
        ne: at(x, y - 1),
        sw: at(x - 1, y),
        se: at(x, y),
      };
      const neighbors = { n: at(x, y - 1), e: at(x + 1, y), s: at(x, y + 1), w: at(x - 1, y) };
      const key = [c, corners.nw, corners.ne, corners.sw, corners.se, neighbors.n, neighbors.e, neighbors.s, neighbors.w, cellSeedFor(x, y) % 7].join('|');
      let gid = atlasMap.get(key);
      if (gid === undefined) {
        gid = atlasTiles.length + 1;
        atlasMap.set(key, gid);
        atlasTiles.push(composeTile(c, corners, neighbors, cellSeedFor(x, y)));
        tileClassByGid.set(gid, c);
      }
      gidByCell[y][x] = gid;
    }
  }

  // Decals.
  const decalTilesList = decalTiles(seed);
  const decalGids: number[][] = Array.from({ length: MAP_H }, () => Array<number>(MAP_W).fill(0));
  const decalRng = makeRng(seed, 'decal-scatter');
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const c = terrain[y][x];
      if (c === 'deep' || c === 'shallow') continue;
      if (decalRng() < 0.05) {
        const pick = Math.floor(decalRng() * decalTilesList.length);
        decalGids[y][x] = pick + 1;
      }
    }
  }

  const sourceHash = hashString(JSON.stringify({ seed, w: MAP_W, h: MAP_H, version: MAP_VERSION })).toString(36);
  return {
    seed,
    terrain,
    objects,
    spawnPoints,
    inlet,
    atlasTiles,
    atlasCols: 32,
    gidByCell,
    tileClassByGid,
    decalTiles: decalTilesList,
    decalGids,
    sourceHash,
  };
}

// --- Write Tiled source files ---

const WANG_COLOR_NAMES: TerrainClass[] = ['deep', 'shallow', 'wetSand', 'drySand', 'grass', 'sparse', 'dense', 'mud', 'rock', 'cliff', 'path'];

export function writeTiledSource(map: GeneratedMap, outDir: string) {
  const tilesDir = path.join(outDir, 'tilesets');
  const mapsDir = path.join(outDir, 'maps');
  fs.mkdirSync(tilesDir, { recursive: true });
  fs.mkdirSync(mapsDir, { recursive: true });

  const terrainPng = atlasFromTiles(map.atlasTiles, map.atlasCols);
  fs.writeFileSync(path.join(outDir, 'normalized-32px', 'terrain.png'), bufferToPng(terrainPng));

  // Decals tileset image.
  const decalPng = atlasFromTiles(map.decalTiles, 8);
  fs.writeFileSync(path.join(outDir, 'normalized-32px', 'decals.png'), bufferToPng(decalPng));

  const cornerIndex = (c: TerrainClass) => WANG_COLOR_NAMES.indexOf(c);
  // Per-tile wangid from cell corner classes.
  const wangByGid = new Map<number, number[]>();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const gid = map.gidByCell[y][x];
      if (wangByGid.has(gid)) continue;
      const at = (xx: number, yy: number): TerrainClass => {
        if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) return map.terrain[y][x];
        return map.terrain[yy][xx];
      };
      wangByGid.set(gid, [cornerIndex(at(x - 1, y - 1)), cornerIndex(at(x, y - 1)), cornerIndex(at(x - 1, y)), cornerIndex(at(x, y))]);
    }
  }

  const terrainTsj = {
    type: 'tileset',
    version: '1.10',
    tiledversion: '1.10.2',
    name: 'terrain',
    tilewidth: 32,
    tileheight: 32,
    tilecount: map.atlasTiles.length,
    columns: map.atlasCols,
    image: '../normalized-32px/terrain.png',
    imagewidth: terrainPng.w,
    imageheight: terrainPng.h,
    wangsets: [
      {
        name: 'TerrainChain',
        type: 'corner',
        colors: WANG_COLOR_NAMES.map((name, i) => ({ color: `#${name}`, name, probability: 1, tile: -1, id: i })),
        tiles: map.atlasTiles.map((_, i) => ({
          tileid: i,
          wangid: wangByGid.get(i + 1) ?? [4, 4, 4, 4],
        })),
      },
    ],
    tiles: map.atlasTiles.map((_, i) => ({
      id: i,
      type: map.tileClassByGid.get(i + 1) ?? 'grass',
    })),
    properties: [{ name: 'generated', type: 'bool', value: true }],
  };
  fs.writeFileSync(path.join(tilesDir, 'terrain.tsj'), JSON.stringify(terrainTsj, null, 1));

  const decalsTsj = {
    type: 'tileset',
    version: '1.10',
    tiledversion: '1.10.2',
    name: 'decals',
    tilewidth: 32,
    tileheight: 32,
    tilecount: map.decalTiles.length,
    columns: 8,
    image: '../normalized-32px/decals.png',
    imagewidth: decalPng.w,
    imageheight: decalPng.h,
    properties: [{ name: 'generated', type: 'bool', value: true }],
  };
  fs.writeFileSync(path.join(tilesDir, 'decals.tsj'), JSON.stringify(decalsTsj, null, 1));

  const terrainData = map.gidByCell.flat();
  const decalData = map.decalGids.flat().map((g) => (g ? g + map.atlasTiles.length : 0));
  const groundLayer = {
    id: 1,
    name: 'TerrainBase',
    type: 'tilelayer',
    width: MAP_W,
    height: MAP_H,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data: terrainData,
  };
  const decalLayer = {
    id: 2,
    name: 'GroundDecals',
    type: 'tilelayer',
    width: MAP_W,
    height: MAP_H,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data: decalData,
  };
  const objectLayers = {
    GroundProps: map.objects.filter((o) => ['rock', 'berry_bush', 'wood_pile', 'wreckage', 'spring'].includes(o.type)),
    TallProps: map.objects.filter((o) => o.type === 'tree'),
    Foreground: map.objects.filter((o) => o.type === 'tree').map((o) => ({ ...o, id: o.id + 100000 })),
    SemanticObjects: map.objects.filter((o) => ['spawn_point', 'item_spawn', 'water_spring', 'landmark_viewpoint'].includes(o.type)),
  };
  const layerList: unknown[] = [groundLayer, decalLayer];
  let lid = 3;
  for (const [name, objs] of Object.entries(objectLayers)) {
    layerList.push({
      id: lid++,
      name,
      type: 'objectgroup',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      objects: objs.map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        properties: Object.entries(o.properties).map(([k, v]) => ({ name: k, type: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'int' : 'string', value: v })),
      })),
    });
  }

  const tmj = {
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    width: MAP_W,
    height: MAP_H,
    tilewidth: 32,
    tileheight: 32,
    infinite: false,
    nextlayerid: lid,
    nextobjectid: map.objects.length + 100001,
    properties: [
      { name: 'seed', type: 'int', value: map.seed },
      { name: 'inlet', type: 'string', value: map.inlet ? JSON.stringify(map.inlet) : '' },
      { name: 'sourceHash', type: 'string', value: map.sourceHash },
      { name: 'gridsDerived', type: 'bool', value: true },
      { name: 'version', type: 'string', value: MAP_VERSION },
    ],
    tilesets: [
      { firstgid: 1, source: '../tilesets/terrain.tsj' },
      { firstgid: map.atlasTiles.length + 1, source: '../tilesets/decals.tsj' },
    ],
    layers: layerList,
  };
  fs.writeFileSync(path.join(mapsDir, 'aisland-mvp2.tmj'), JSON.stringify(tmj));
}

export function buildCharacterSheetNormalized(): { png: Buffer; meta: unknown } {
  const src = path.join(__dirname, '../../assets/source/mvp2/original/pixel-boy-ninja-adventure');
  const PNG16 = 16;
  const readPng = (p: string): PixelBuffer => {
    const png = PNG.sync.read(fs.readFileSync(p));
    return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data) };
  };
  const blue = readPng(path.join(src, 'ninja_blue.png'));
  const green = readPng(path.join(src, 'samurai_green.png'));
  const orange = paletteSwap(blue, [
    [[84, 120, 186], [204, 122, 58]],
    [[118, 158, 214], [228, 152, 78]],
    [[52, 78, 122], [152, 84, 40]],
    [[206, 224, 244], [242, 228, 198]],
  ]);
  const chars: PixelBuffer[] = [blue, green, orange];
  const charNames = ['linche', 'shilei', 'suhe'];
  const ROWS = 4;
  const FRAMES = 4;
  const frameStart = 2;
  const meta: Record<string, unknown> = { version: 'characters-v1', tileSize: 16, characters: {} };
  const tiles: PixelBuffer[] = [];
  for (let c = 0; c < chars.length; c++) {
    const framesOfChar: number[] = [];
    for (let d = 0; d < ROWS; d++) {
      for (let f = 0; f < FRAMES; f++) {
        const sx = f * PNG16;
        const sy = (d * 7 + frameStart + f) * PNG16;
        const frameBuf = { w: PNG16, h: PNG16, data: new Uint8ClampedArray(PNG16 * PNG16 * 4) };
        for (let y = 0; y < PNG16; y++) {
          for (let x = 0; x < PNG16; x++) {
            const [r, g, b, a] = getPx(chars[c], sx + x, sy + y);
            setPx(frameBuf, x, y, [r, g, b], a);
          }
        }
        framesOfChar.push(tiles.length);
        tiles.push(frameBuf);
      }
    }
    meta.characters[charNames[c]] = { sheet: 0, firstFrame: framesOfChar[0], frames: framesOfChar, rows: ROWS, framesPerRow: FRAMES, dirOrder: ['down', 'left', 'right', 'up'] };
  }
  const atlas32 = nearestScale(atlasFromTiles(tiles, 16), 2);
  return { png: bufferToPng(atlas32), meta };
}

export function buildPropsAndEffects(seed: number): { propsPng: Buffer; effectsPng: Buffer; propMeta: unknown } {
  const rng = makeRng(seed, 'props');
  const props: PixelBuffer[] = [
    treeSprite(rng, 0),
    treeSprite(rng, 1),
    treeSprite(rng, 2),
    rockSprite(rng, true),
    berryBushSprite(rng),
    woodLogSprite(),
    wreckageSprite(rng),
    cliffFaceTexture(rng),
  ];
  const propNames = ['tree_0', 'tree_1', 'tree_2', 'rock', 'berry_bush', 'wood_log', 'wreckage', 'cliff_face'];
  const effects: PixelBuffer[] = [fireSprite(0), fireSprite(1), fireSprite(2), fireSprite(3)];
  const items: PixelBuffer[] = [waterBottleSprite(), foodRationSprite(), lighterSprite(), tinderSprite(), backpackSprite()];
  const itemNames = ['water_bottle', 'food_ration', 'lighter', 'tinder', 'backpack'];
  const propsAtlas = atlasFromTiles([...props, ...items], 8);
  const effectsAtlas = atlasFromTiles(effects, 4);
  return {
    propsPng: bufferToPng(propsAtlas),
    effectsPng: bufferToPng(effectsAtlas),
    propMeta: {
      version: 'props-v1',
      props: Object.fromEntries(propNames.map((n, i) => [n, { atlas: 'props.png', tile: i }])),
      items: Object.fromEntries(itemNames.map((n, i) => [n, { atlas: 'props.png', tile: propNames.length + i }])),
      effects: Object.fromEntries(['fire_0', 'fire_1', 'fire_2', 'fire_3'].map((n, i) => [n, { atlas: 'effects.png', tile: i }])),
    },
  };
}

export function run(seed: number, outDir: string) {
  const map = generateMap(seed);
  writeTiledSource(map, outDir);
  const chars = buildCharacterSheetNormalized();
  fs.writeFileSync(path.join(outDir, 'normalized-32px', 'characters.png'), chars.png);
  fs.writeFileSync(path.join(outDir, 'normalized-32px', 'characters.meta.json'), JSON.stringify(chars.meta, null, 1));
  const props = buildPropsAndEffects(seed);
  fs.writeFileSync(path.join(outDir, 'normalized-32px', 'props.png'), props.propsPng);
  fs.writeFileSync(path.join(outDir, 'normalized-32px', 'effects.png'), props.effectsPng);
  fs.writeFileSync(path.join(outDir, 'normalized-32px', 'props.meta.json'), JSON.stringify(props.propMeta, null, 1));
  console.log(JSON.stringify({ seed, sourceHash: map.sourceHash, terrainTiles: map.atlasTiles.length, objects: map.objects.length, spawn: map.spawnPoints, inlet: map.inlet }, null, 1));
}
