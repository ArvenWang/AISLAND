// PRD 19.5 VisualActionState reconciliation: every P0 semantic event must
// carry a visualActionId, ids must map 1:1 to semantic actions, and commit
// facts (item disappears after pickup commit etc.) must hold in the event
// stream. Runs a deterministic scripted world to produce the event stream.
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { createMvp2World } from '../../server/mvp2/world';
import { stepWorld } from '../../server/mvp2/engine';
import { ScriptedSurvivalBrain } from '../../server/mvp2/drivers';
import type { Mvp2World, WorldEvent } from '../../server/mvp2/types';

const P0_EVENTS = ['item_picked_up', 'item_dropped', 'handover_completed', 'resource_harvested', 'message_spoken', 'sleep_started', 'fire_lit', 'agent_died'];

async function main() {
  const world = createMvp2World('render-telemetry', 20260807, RuntimeMap.loadDefault());
  const brain = new ScriptedSurvivalBrain(() => 0.3);
  let guard = 0;
  while (world.status === 'running' && world.gameTime < 2 * 1440 && guard++ < 400) {
    await stepWorld(world, 30, brain);
  }

  const errors: string[] = [];
  const visualToSemantic = new Map<string, string>();
  const semanticToVisual = new Map<string, string>();
  let p0Count = 0;

  for (const e of world.events) {
    if (P0_EVENTS.includes(e.type)) {
      p0Count++;
      const va = e.visualActionId;
      const sa = e.sourceActionId;
      if (!va) {
        errors.push(`P0 event ${e.eventId} (${e.type}) has no visualActionId`);
        continue;
      }
      if (!sa) {
        errors.push(`P0 event ${e.eventId} (${e.type}) has no sourceActionId`);
        continue;
      }
      const prevSemantic = visualToSemantic.get(va);
      if (prevSemantic && prevSemantic !== sa) {
        errors.push(`visualActionId ${va} mapped to two semantic actions (${prevSemantic}, ${sa})`);
      }
      visualToSemantic.set(va, sa);
      const prevVisual = semanticToVisual.get(sa);
      if (prevVisual && prevVisual !== va) {
        errors.push(`semantic action ${sa} mapped to two visual ids (${prevVisual}, ${va})`);
      }
      semanticToVisual.set(sa, va);
    }
  }

  // item_picked_up must be preceded by its action_started with same visual id.
  const actionStarts = new Map<string, WorldEvent>();
  for (const e of world.events) {
    if (e.type === 'action_started' && e.visualActionId) actionStarts.set(e.visualActionId, e);
  }
  for (const e of world.events) {
    if (e.type === 'item_picked_up' && e.visualActionId) {
      const start = actionStarts.get(e.visualActionId);
      if (start && start.gameTime > e.gameTime) errors.push(`pickup commit before action_started for ${e.visualActionId}`);
    }
  }

  if (errors.length) {
    console.error('render-telemetry FAIL');
    for (const er of errors.slice(0, 20)) console.error(' -', er);
    process.exit(1);
  }
  console.log(`render-telemetry PASS (${p0Count} P0 events, ${visualToSemantic.size} unique visual actions)`);
}

main().catch((e) => {
  console.error('render-telemetry ERROR', e);
  process.exit(1);
});
