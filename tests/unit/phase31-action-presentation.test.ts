import * as fs from 'node:fs';
import * as path from 'node:path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { startAction, stepWorldMovement } from '../../server/mvp2/engine';
import { createMvp2World } from '../../server/mvp2/world';

function makeWorld() {
  const map = RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/island-01/map.runtime.json'));
  return createMvp2World('phase31-action-presentation', 71, map);
}

describe('Phase 3.1 action presentation contract', () => {
  test('state mutation happens inside the authoritative commit window', () => {
    const world = makeWorld();
    const agent = world.agents.agent_a;
    const item = Object.values(world.groundItems).find((candidate) => candidate.kind === 'water');
    expect(item).toBeDefined();
    agent.x = item!.x;
    agent.y = item!.y;
    const action = startAction(world, agent, { type: 'pickup_item', target: { kind: 'item', itemId: item!.itemId } });
    expect(action).not.toBeNull();
    expect(action!.endsAt - action!.startedAt).toBe(5);

    stepWorldMovement(world, 3);
    expect(agent.currentAction?.phase).toBe('perform');
    expect(world.groundItems[item!.itemId]).toBeDefined();
    expect(agent.currentAction?.commitAt).toBeUndefined();

    stepWorldMovement(world, 0.5);
    expect(agent.currentAction?.phase).toBe('commit');
    expect(agent.currentAction?.commitAt).toBe(world.gameTime);
    expect(world.groundItems[item!.itemId]).toBeUndefined();
    const commitEvent = world.events.find((event) => event.type === 'item_picked_up' && event.sourceActionId === action!.actionId);
    expect(commitEvent?.gameTime).toBe(agent.currentAction?.commitAt);

    stepWorldMovement(world, 1.5);
    expect(agent.currentAction).toBeNull();
  });

  test('1x clock and readable action durations match the product pacing gate', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '../../server/mvp2/api.ts'), 'utf8');
    expect(apiSource).toContain('tickMs: 250, stepMin: 1');
    const world = makeWorld();
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    a.x = 20;
    a.y = 20;
    b.x = 21;
    b.y = 20;
    const talk = startAction(world, a, { type: 'talk', target: { kind: 'agent', agentId: b.id }, text: '我们先看看周围，再决定往哪里走。' });
    expect(talk).not.toBeNull();
    expect(talk!.endsAt - talk!.startedAt).toBeGreaterThanOrEqual(14);
    expect(talk!.endsAt - talk!.startedAt).toBeLessThanOrEqual(28);
  });
});
