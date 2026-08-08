import * as fs from 'node:fs';
import * as path from 'node:path';

type WorldObject = {
  id: string;
  type: string;
  cellX: number;
  cellY: number;
  properties: Record<string, unknown>;
};

type WorldAssetMeta = {
  assetId: string;
  variantGroup?: string;
  reusePolicy: 'unique' | 'limited' | 'repeatable' | 'stateful';
  maxInstances?: number;
  minSameVariantDistance?: number;
  displaySize: [number, number];
  anchor: [number, number];
  collisionFootprint?: [number, number];
  interactionPoint?: [number, number];
  stateGroup?: string;
};

type PropsManifest = {
  version: string;
  entries: Record<string, unknown>;
  aliases: Record<string, string>;
  worldAssetMeta: Record<string, WorldAssetMeta>;
};

const root = path.join(__dirname, '../..');
const runtimePath = path.join(root, 'public/generated/maps/island-01/map.runtime.json');
const manifestPath = path.join(root, 'assets/source/phase3/atlases/props.meta.json');
const outputPath = path.join(root, 'acceptance/phase31/assets/asset-reuse-audit.json');
const visualTypes = new Set([
  'wreck_main', 'wreck_tail', 'crash_debris', 'tree', 'rock', 'water_spring',
  'berry_bush', 'wood_pile', 'landmark_viewpoint',
]);

function manhattan(a: WorldObject, b: WorldObject): number {
  return Math.abs(a.cellX - b.cellX) + Math.abs(a.cellY - b.cellY);
}

function isFinitePair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

export function auditAssetReuse(): Record<string, unknown> {
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8')) as { version: string; objects: WorldObject[] };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PropsManifest;
  const objects = runtime.objects.filter((object) => visualTypes.has(object.type));
  const violations: Array<{ gate: string; message: string; objectIds?: string[] }> = [];
  const resolved = objects.map((object) => {
    const assetId = typeof object.properties.assetId === 'string' ? object.properties.assetId : '';
    const meta = manifest.worldAssetMeta[assetId];
    if (!assetId) violations.push({ gate: 'AST-META', message: `${object.type} ${object.id} is missing assetId`, objectIds: [object.id] });
    if (!meta) violations.push({ gate: 'AST-META', message: `${object.id} references unknown assetId ${assetId || '(empty)'}`, objectIds: [object.id] });
    if (meta) {
      if (meta.assetId !== assetId) violations.push({ gate: 'AST-META', message: `${assetId} metadata carries mismatched assetId ${meta.assetId}` });
      if (!['unique', 'limited', 'repeatable', 'stateful'].includes(meta.reusePolicy)) violations.push({ gate: 'AST-META', message: `${assetId} has invalid reusePolicy` });
      if (object.properties.reusePolicy !== meta.reusePolicy) violations.push({ gate: 'AST-META', message: `${object.id} reusePolicy ${String(object.properties.reusePolicy)} does not match ${assetId} metadata ${meta.reusePolicy}` });
      if (!isFinitePair(meta.displaySize) || !isFinitePair(meta.anchor) || !isFinitePair(meta.collisionFootprint) || !isFinitePair(meta.interactionPoint)) {
        violations.push({ gate: 'AST-006', message: `${assetId} lacks independent display/anchor/collision/interaction metadata` });
      }
    }
    return { object, assetId, meta };
  });

  const counts = new Map<string, number>();
  for (const entry of resolved) counts.set(entry.assetId, (counts.get(entry.assetId) ?? 0) + 1);
  for (const entry of resolved) {
    if (!entry.meta) continue;
    const count = counts.get(entry.assetId) ?? 0;
    if (entry.meta.reusePolicy === 'unique' && count > 1) {
      violations.push({ gate: 'AST-001', message: `${entry.assetId} is unique but has ${count} map instances` });
    }
    if (entry.meta.maxInstances !== undefined && count > entry.meta.maxInstances) {
      violations.push({ gate: 'AST-001', message: `${entry.assetId} exceeds maxInstances ${entry.meta.maxInstances}: ${count}` });
    }
  }

  const fuselages = objects.filter((object) => object.type === 'wreck_main');
  if (fuselages.length !== 1 || fuselages[0]?.properties.assetId !== 'wreck_fuselage_full') {
    violations.push({ gate: 'AST-002', message: `expected one wreck_main using wreck_fuselage_full, found ${fuselages.length}` });
  }

  const trees = resolved.filter((entry) => entry.object.type === 'tree');
  for (let i = 0; i < trees.length; i++) {
    const sameInWindow = trees.filter((other) => other.assetId === trees[i].assetId && Math.abs(other.object.cellX - trees[i].object.cellX) <= 2 && Math.abs(other.object.cellY - trees[i].object.cellY) <= 2);
    if (sameInWindow.length > 2) {
      violations.push({ gate: 'AST-003', message: `${trees[i].assetId} appears ${sameInWindow.length} times in a 5x5 window`, objectIds: sameInWindow.map((entry) => entry.object.id) });
    }
    for (let j = i + 1; j < trees.length; j++) {
      if (trees[i].assetId === trees[j].assetId && manhattan(trees[i].object, trees[j].object) <= 2) {
        violations.push({ gate: 'AST-003', message: `${trees[i].assetId} repeats within two cells`, objectIds: [trees[i].object.id, trees[j].object.id] });
      }
    }
  }

  const groupAssetIds = new Map<string, Set<string>>();
  for (const assetId of Object.keys(manifest.entries)) {
    const group = manifest.worldAssetMeta[assetId]?.variantGroup;
    if (!group) continue;
    if (!groupAssetIds.has(group)) groupAssetIds.set(group, new Set());
    groupAssetIds.get(group)!.add(assetId);
  }
  const variantShares: Record<string, Record<string, number>> = {};
  for (const [group, assetIds] of groupAssetIds) {
    if (assetIds.size < 6) continue;
    const instances = resolved.filter((entry) => entry.meta?.variantGroup === group);
    if (!instances.length) continue;
    variantShares[group] = {};
    for (const assetId of assetIds) {
      const share = instances.filter((entry) => entry.assetId === assetId).length / instances.length;
      variantShares[group][assetId] = share;
      if (share > 0.25) violations.push({ gate: 'AST-004', message: `${group}/${assetId} occupies ${(share * 100).toFixed(1)}% of instances` });
    }
  }

  const large = resolved.filter((entry) => entry.meta && Math.max(...entry.meta.displaySize) > 96);
  for (let i = 0; i < large.length; i++) {
    for (let j = i + 1; j < large.length; j++) {
      if (large[i].assetId === large[j].assetId && manhattan(large[i].object, large[j].object) <= 1) {
        violations.push({ gate: 'AST-005', message: `adjacent large props reuse ${large[i].assetId}`, objectIds: [large[i].object.id, large[j].object.id] });
      }
    }
  }

  const sceneSource = fs.readFileSync(path.join(root, 'src/components/pixi/map/MapScene.tsx'), 'utf8');
  if (/spr\.scale\.set\([^,\n]+,\s*[^)\n]+\)/.test(sceneSource)) {
    violations.push({ gate: 'AST-006', message: 'MapScene applies non-uniform scaling to a world prop' });
  }
  for (const { object, assetId } of resolved) {
    if (/debug|rectangle|inventory|count|[\u{1F300}-\u{1FAFF}]/iu.test(assetId)) {
      violations.push({ gate: 'AST-007', message: `${object.id} uses a debug/emoji/inventory surrogate assetId: ${assetId}`, objectIds: [object.id] });
    }
  }

  const report = {
    schema: 'aisland.phase31.asset_reuse_audit.v1',
    passed: violations.length === 0,
    mapVersion: runtime.version,
    manifestVersion: manifest.version,
    gates: ['AST-001', 'AST-002', 'AST-003', 'AST-004', 'AST-005', 'AST-006', 'AST-007'],
    counts: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    variantShares,
    violations,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  if (violations.length) throw new Error(`Phase 3.1 asset reuse audit failed with ${violations.length} violation(s); see ${path.relative(root, outputPath)}`);
  return report;
}

if (require.main === module) console.log(JSON.stringify(auditAssetReuse(), null, 2));
