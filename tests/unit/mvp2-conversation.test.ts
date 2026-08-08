import * as path from 'path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { decideAgents, startAction, stepWorldMovement } from '../../server/mvp2/engine';
import { createMvp2World } from '../../server/mvp2/world';
import type { AgentBrain } from '../../server/mvp2/engine';

function makeWorld() {
  const map = RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/island-01/map.runtime.json'));
  const world = createMvp2World('conversation-test', 1, map);
  world.agents.agent_a.x = 20;
  world.agents.agent_a.y = 20;
  world.agents.agent_b.x = 21;
  world.agents.agent_b.y = 20;
  for (const agent of Object.values(world.agents)) agent.cognitive.visible.fill(1);
  return world;
}

describe('MVP2 conversation sessions', () => {
  test('a talk creates a pending response and the second turn is an independent decision', async () => {
    const world = makeWorld();
    const first = startAction(world, world.agents.agent_a, { type: 'talk', target: { kind: 'agent', agentId: 'agent_b' }, text: '你叫什么名字？' });
    expect(first).not.toBeNull();
    stepWorldMovement(world, 12);

    const session = Object.values(world.conversations)[0];
    expect(session.status).toBe('awaiting_response');
    expect(session.turns).toHaveLength(1);
    expect(world.agents.agent_b.pendingConversation?.fromId).toBe('agent_a');

    let llmTurns = 0;
    const brain: AgentBrain = {
      async requestDecision(_world, agentId) {
        if (agentId !== 'agent_b') return null;
        llmTurns++;
        return {
          plan: {},
          action: { type: 'talk', target: { kind: 'agent', agentId: 'agent_a' }, text: '我是石磊。' },
        };
      },
    };
    await decideAgents(world, brain, 'day');
    expect(llmTurns).toBe(1);
    stepWorldMovement(world, 12);

    expect(session.status).toBe('completed');
    expect(session.turns).toHaveLength(2);
    expect(session.turns[1].speakerId).toBe('agent_b');
    expect(world.agents.agent_b.pendingConversation).toBeUndefined();
  });
});
