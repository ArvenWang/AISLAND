import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(__dirname, '../..');

function readJson<T>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as T;
}

function sha256(relative: string): string {
  return createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
}

type WangTileset = {
  tilecount: number;
  tiles?: Array<{ id: number }>;
  wangsets: Array<{
    type: string;
    tiles?: unknown[];
    wangtiles: Array<{ tileid: number; wangid: number[] }>;
  }>;
};

describe('Phase 3 visual asset contract', () => {
  test('terrain and cliffs use official eight-position Mixed Wang metadata', () => {
    for (const name of ['terrain', 'cliffs']) {
      const tileset = readJson<WangTileset>(`assets/source/phase3/tilesets/${name}.tsj`);
      const wangset = tileset.wangsets[0];
      expect(wangset.type).toBe('mixed');
      expect(wangset.tiles).toBeUndefined();
      expect(wangset.wangtiles).toHaveLength(tileset.tilecount);
      expect(wangset.wangtiles.every((tile) => tile.wangid.length === 8)).toBe(true);
      expect(new Set(wangset.wangtiles.map((tile) => tile.tileid)).size).toBe(tileset.tilecount);
      if (name === 'terrain') expect(tileset.tiles).toHaveLength(tileset.tilecount);
    }
  });

  test('terrain and cliff seam QC is exhaustive and lossless at tile boundaries', () => {
    const qc = readJson<{
      passed: boolean;
      atlas: { tiles: number };
      cliffs: {
        tiles: number;
        seams: {
          horizontalCompatiblePairs: number;
          verticalCompatiblePairs: number;
          horizontalMaxChannelDelta: number;
          verticalMaxChannelDelta: number;
          passed: boolean;
        };
      };
      seams: {
        horizontalCompatiblePairs: number;
        verticalCompatiblePairs: number;
        horizontalMaxChannelDelta: number;
        verticalMaxChannelDelta: number;
        diagonalCornerMaxColorVariants: number;
      };
    }>('acceptance/phase3/visual-v2/terrain-v2-qc.json');
    expect(qc.passed).toBe(true);
    expect(qc.atlas.tiles).toBe(408);
    expect(qc.seams.horizontalCompatiblePairs).toBe(9952);
    expect(qc.seams.verticalCompatiblePairs).toBe(9808);
    expect(qc.seams.horizontalMaxChannelDelta).toBe(0);
    expect(qc.seams.verticalMaxChannelDelta).toBe(0);
    expect(qc.seams.diagonalCornerMaxColorVariants).toBe(1);
    expect(qc.cliffs.tiles).toBe(16);
    expect(qc.cliffs.seams.passed).toBe(true);
    expect(qc.cliffs.seams.horizontalCompatiblePairs).toBe(64);
    expect(qc.cliffs.seams.verticalCompatiblePairs).toBe(64);
    expect(qc.cliffs.seams.horizontalMaxChannelDelta).toBe(0);
    expect(qc.cliffs.seams.verticalMaxChannelDelta).toBe(0);
  });

  test('catalog installs six generated material masters and all compiled atlases', () => {
    const catalog = readJson<{
      status: string;
      terrain: { materials: string[]; atlas: string; cliffAtlas: string };
      characters: { compiledFrames: number; atlas: string };
      worldAssets: { compiledEntries: number; atlas: string };
      decals: { compiledEntries: number; atlas: string };
      effects: { compiledFrames: number; atlas: string };
    }>('assets/source/phase3/v2/manifests/asset-catalog.json');
    expect(catalog.status).toBe('installed-and-live-verified');
    expect(catalog.terrain.materials).toEqual(['deep', 'shallow', 'wetSand', 'drySand', 'grass', 'rock']);
    expect(catalog.characters.compiledFrames).toBe(96);
    expect(catalog.worldAssets.compiledEntries).toBe(42);
    expect(catalog.decals.compiledEntries).toBe(16);
    expect(catalog.effects.compiledFrames).toBe(32);
    for (const relative of [
      catalog.terrain.atlas,
      catalog.terrain.cliffAtlas,
      catalog.characters.atlas,
      catalog.worldAssets.atlas,
      catalog.decals.atlas,
      catalog.effects.atlas,
    ]) expect(fs.existsSync(path.join(root, relative))).toBe(true);
    for (const file of ['deep-water-v1.png', 'shallow-water-v1.png', 'wet-sand-v1.png', 'dry-sand-v1.png', 'grass-v1.png', 'rock-v1.png']) {
      expect(fs.existsSync(path.join(root, 'assets/source/phase3/v2/materials/raw', file))).toBe(true);
    }
    const stagedTileset = fs.readFileSync(path.join(root, 'assets/source/phase3/v2/tilesets/terrain-v2.tsj'), 'utf8');
    expect(stagedTileset).not.toContain('rock-rejected-cobble-v1');
  });

  test('civilian character, prop-state, decal and effect manifests are complete', () => {
    const characters = readJson<{
      version: string;
      characters: Record<string, {
        frameCount: number;
        directions: Record<string, { walk: number[] }>;
        actions: Record<string, number>;
      }>;
    }>('assets/source/phase3/atlases/characters.meta.json');
    expect(characters.version).toBe('phase3-characters-v2');
    expect(Object.keys(characters.characters)).toEqual(['linche', 'shilei', 'suhe']);
    const actionNames = [
      'observe', 'low_reach', 'consume', 'offer', 'receive', 'refuse', 'talk', 'shout',
      'build_fire', 'add_fuel', 'search', 'rest', 'sleep', 'wake', 'exhausted', 'death',
    ];
    for (const character of Object.values(characters.characters)) {
      expect(character.frameCount).toBe(32);
      expect(Object.keys(character.directions)).toEqual(['down', 'left', 'right', 'up']);
      expect(Object.values(character.directions).every((direction) => direction.walk.length === 4)).toBe(true);
      expect(Object.keys(character.actions)).toEqual(actionNames);
    }

    const props = readJson<{
      version: string;
      entries: Record<string, unknown>;
      resourceStates: Record<string, Record<string, string>>;
    }>('assets/source/phase3/atlases/props.meta.json');
    expect(props.version).toBe('phase3-props-v2');
    expect(Object.keys(props.entries)).toHaveLength(42);
    expect(Object.keys(props.resourceStates.spring)).toEqual(['full', 'used', 'low', 'depleted']);
    expect(Object.keys(props.resourceStates.berry_bush)).toEqual(['full', 'used', 'depleted', 'regrowing']);
    expect(Object.keys(props.resourceStates.wood_pile)).toEqual(['full', 'used', 'depleted', 'regrowing']);
    expect(Object.keys(props.resourceStates.fire)).toEqual(['unlit', 'burning', 'weak', 'embers', 'out']);

    const decals = readJson<{ version: string; entries: Record<string, unknown> }>('assets/source/phase3/atlases/decals.meta.json');
    expect(decals.version).toBe('phase3-decals-v2');
    expect(Object.keys(decals.entries)).toHaveLength(16);

    const effects = readJson<{
      version: string;
      sequences: Record<string, number[]>;
      frameMs: Record<string, number>;
    }>('assets/source/phase3/atlases/effects.meta.json');
    expect(effects.version).toBe('phase3-effects-v2');
    expect(Object.keys(effects.sequences)).toEqual(['pickup', 'handover', 'shout', 'fire_light', 'shore_foam', 'harvest', 'refuse', 'sleep']);
    expect(Object.values(effects.sequences).flat()).toHaveLength(32);
    expect(Object.keys(effects.frameMs)).toEqual(Object.keys(effects.sequences));
  });

  test('generated source provenance is complete and hashes every output', () => {
    const provenance = readJson<{
      generator: { mode: string; apiScriptUsed: boolean };
      promptTemplates: Record<string, string>;
      records: Array<{
        output: string;
        sha256: string;
        prompt?: string;
        promptTemplate?: string;
        status: string;
      }>;
    }>('assets/source/phase3/v2/prompts/visual-generation-v1.json');
    expect(provenance.generator.mode).toBe('built-in image generation tool');
    expect(provenance.generator.apiScriptUsed).toBe(false);
    expect(provenance.records).toHaveLength(22);
    expect(provenance.records.filter((record) => record.status === 'accepted')).toHaveLength(21);
    expect(provenance.records.filter((record) => record.status === 'rejected')).toHaveLength(1);
    for (const record of provenance.records) {
      expect(fs.existsSync(path.join(root, record.output))).toBe(true);
      expect(sha256(record.output)).toBe(record.sha256);
      if (record.prompt) expect(fs.existsSync(path.join(root, record.prompt))).toBe(true);
      if (record.promptTemplate) expect(provenance.promptTemplates[record.promptTemplate]).toBeTruthy();
    }
  });

  test('runtime renderer uses generated manifests and has no legacy warrior source path', () => {
    const scene = fs.readFileSync(path.join(root, 'src/components/pixi/map/MapScene.tsx'), 'utf8');
    const assets = fs.readFileSync(path.join(root, 'src/components/pixi/map/MapAssets.ts'), 'utf8');
    expect(scene).toContain("effectTexture('shore_foam'");
    expect(scene).toContain('resourceStates');
    expect(scene).toContain("String(o.properties.assetId ?? '')");
    expect(scene).not.toContain('propTypeToName');
    expect(scene).toContain("o.type === 'water_spring'");
    expect(assets).toContain('characters.meta.json');
    expect(assets).toContain('effects.meta.json');
    expect(`${scene}\n${assets}`).not.toMatch(/ninja|samurai|AGENT_SRC|SRC_BASE/i);
  });
});
