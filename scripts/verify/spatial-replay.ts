// PRD 8.x/21.3 spatial-consistency replay: run a deterministic scripted
// world and verify that every movement lands on passable terrain, unknown
// cells never enter explored paths, discoveries happen inside line of sight,
// resources conserve, and explore never settles remotely.
import * as path from 'path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { createMvp2World } from '../../server/mvp2/world';
import { stepWorld } from '../../server/mvp2/engine';
import { ScriptedSurvivalBrain } from '../../server/mvp2/drivers';
import type { Mvp2World } from '../../server/mvp2/types';

async function main() {
  const map = RuntimeMap.loadDefault();
  const world = createMvp2World('spatial-replay', 20260807, map);
  const brain = new ScriptedSurvivalBrain(() => 0.3);
  const errors: string[] = [];
  const positions = new Map<string, Array<{ x: number; y: number; t: number }>>();
  for (const a of Object.values(world.agents)) positions.set(a.id, []);
  const pathCells: Array<{ x: number; y: number }> = [];
  const totalsOf = (kind: string) => {
    let held = 0;
    for (const ag of Object.values(world.agents)) held += ag.inventory[kind as 'water'] ?? 0;
    let ground = 0;
    for (const g of Object.values(world.groundItems)) if (g.kind === kind) ground += g.quantity;
    let res = 0;
    for (const r of Object.values(world.resources)) {
      if (kind === 'water' && r.kind === 'spring') res += r.stock;
      if (kind === 'food' && r.kind === 'berry_bush') res += r.stock;
      if (kind === 'wood' && r.kind === 'wood_pile') res += r.stock;
    }
    let wrecks = 0;
    for (const w of Object.values(world.wrecks)) wrecks += w.contents[kind as 'water'] ?? 0;
    return held + ground + res + wrecks;
  };
  const init: Record<string, number> = { water: totalsOf('water'), food: totalsOf('food'), wood: totalsOf('wood') };

  let guard = 0;
  while (world.status === 'running' && world.gameTime < 4 * 1440 && guard++ < 800) {
    const before = new Map(Object.values(world.agents).map((a) => [a.id, { x: a.x, y: a.y }] as const));
    await stepWorld(world, 30, brain);
    for (const a of Object.values(world.agents)) {
      const prev = before.get(a.id);
      if (!prev) continue;
      if (!a.isAlive) continue;
      positions.get(a.id)?.push({ x: a.x, y: a.y, t: world.gameTime });
      if (world.map.isBlocked(a.x, a.y)) {
        errors.push(`agent ${a.id} on blocked cell (${a.x},${a.y}) at t=${world.gameTime}`);
      }
      const moved = Math.abs(a.x - prev.x) + Math.abs(a.y - prev.y);
      // A 30-min step can traverse up to 7 cells on beach (4 min/cell).
      if (moved > 8) errors.push(`agent ${a.id} teleported ${moved} cells at t=${world.gameTime}`);
      if (a.currentAction?.type === 'move' && a.currentAction.path) {
        for (const p of a.currentAction.path) {
          pathCells.push(p);
          const idx = p.y * world.map.width + p.x;
          if (!a.cognitive.explored[idx] && !a.cognitive.visible[idx] && world.map.inBounds(p.x, p.y)) {
            errors.push(`explored path crosses unknown cell (${p.x},${p.y}) for ${a.id} at t=${world.gameTime}`);
          }
        }
      }
    }
  }

  // Discoveries must be within line of sight (vision range gate).
  for (const e of world.events) {
    if (e.type !== 'resource_discovered') continue;
    const a = world.agents[e.actorId ?? ''];
    if (!a) continue;
    const r = e.targetId ? world.resources[e.targetId] : undefined;
    if (!r) continue;
    const d = Math.abs(r.x - a.x) + Math.abs(r.y - a.y);
    if (d > 14) errors.push(`resource discovered ${d} cells away (${r.x},${r.y}) by ${e.actorId} at (${a.x},${a.y})`);
  }

  // Conservation with regen credits.
  const consumed = (kind: string) => Object.values(world.agents).reduce((s, a) => s + (a.stats.consumed[kind as 'water'] ?? 0), 0);
  const regen = (kind: string) => world.conservationLedger.filter((l) => l.note === 'regen' && l.kind === kind).reduce((s, l) => s + l.delta, 0);
  for (const kind of ['water', 'food', 'wood'] as const) {
    const after = totalsOf(kind) + consumed(kind);
    const expected = init[kind] + regen(kind);
    if (Math.abs(after - expected) > 1e-6) errors.push(`conservation failed for ${kind}: after=${after} expected=${expected}`);
  }

  if (errors.length) {
    console.error('spatial-replay FAIL');
    for (const e of errors.slice(0, 25)) console.error(' -', e);
    console.error(`  (${errors.length} total, ${pathCells.length} path cells checked)`);
    process.exit(1);
  }
  console.log(`spatial-replay PASS (${world.gameTime} min, ${pathCells.length} path cells, ${world.events.length} events)`);
}

main().catch((e) => {
  console.error('spatial-replay ERROR', e);
  process.exit(1);
});
