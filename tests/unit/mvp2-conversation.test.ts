import * as path from 'path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { decideAgents, startAction, stepWorldMovement } from '../../server/mvp2/engine';
import { createMvp2World } from '../../server/mvp2/world';
import { sanitizeMvp2World } from '../../server/mvp2/api';
import type { AgentBrain } from '../../server/mvp2/engine';
import { buildPlannerMessages } from '../../server/mvp2/planner';

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
  test('directed speech cannot commit remotely and instead starts a physical approach', () => {
    const world = makeWorld();
    world.agents.agent_b.x = 25;
    world.agents.agent_b.y = 20;

    const started = startAction(world, world.agents.agent_a, {
      type: 'talk',
      target: { kind: 'agent', agentId: 'agent_b' },
      text: '你能听见吗？',
    }, 'llm_remote_talk');

    expect(started?.type).toBe('move');
    expect(started?.pending?.type).toBe('talk');
    expect(world.events.some((event) => event.type === 'message_spoken')).toBe(false);
    const approach = world.events.find((event) => event.type === 'action_started' && event.payload.type === 'approach');
    expect(approach?.payload.targetType).toBe('talk');
    expect(approach?.payload.llmRequestId).toBe('llm_remote_talk');
  });

  test('a talk creates a pending response and the second turn is an independent decision', async () => {
    const world = makeWorld();
    const first = startAction(world, world.agents.agent_a, { type: 'talk', target: { kind: 'agent', agentId: 'agent_b' }, text: '你叫什么名字？' });
    expect(first).not.toBeNull();
    stepWorldMovement(world, 30);

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
    stepWorldMovement(world, 30);

    expect(session.status).toBe('awaiting_response');
    expect(session.turns).toHaveLength(2);
    expect(session.turns[1].speakerId).toBe('agent_b');
    expect(world.agents.agent_b.pendingConversation).toBeUndefined();
    expect(world.agents.agent_a.pendingConversation?.fromId).toBe('agent_b');
  });

  test('conversation ordering blocks an initiator from opening again before the target responds', () => {
    const world = makeWorld();
    startAction(world, world.agents.agent_a, { type: 'talk', target: { kind: 'agent', agentId: 'agent_b' }, text: '我们交换一下信息。' });
    stepWorldMovement(world, 30);
    expect(world.agents.agent_b.pendingConversation?.fromId).toBe('agent_a');

    const duplicateOpening = startAction(world, world.agents.agent_a, { type: 'talk', target: { kind: 'agent', agentId: 'agent_b' }, text: '我们交换一下信息。' });
    expect(duplicateOpening).toBeNull();
    expect(world.events.filter((event) => event.type === 'message_spoken')).toHaveLength(1);
    expect(world.events.some((event) => event.type === 'action_rejected' && event.payload.reason === 'awaiting_response')).toBe(true);
  });

  test('a reply cannot mirror the previous visible utterance verbatim', () => {
    const world = makeWorld();
    const line = '好，我们一起去找水吧。';
    startAction(world, world.agents.agent_a, { type: 'talk', target: { kind: 'agent', agentId: 'agent_b' }, text: line });
    stepWorldMovement(world, 30);

    const mirrored = startAction(world, world.agents.agent_b, { type: 'talk', target: { kind: 'agent', agentId: 'agent_a' }, text: line });
    expect(mirrored).toBeNull();
    expect(world.events.filter((event) => event.type === 'message_spoken')).toHaveLength(1);
    expect(world.events.some((event) => event.type === 'action_rejected' && event.payload.reason === 'duplicate_utterance')).toBe(true);

    const distinct = startAction(world, world.agents.agent_b, { type: 'talk', target: { kind: 'agent', agentId: 'agent_a' }, text: '我愿意同行，但先确认方向。' });
    expect(distinct?.type).toBe('talk');
  });

  test('an earlier line cannot be repeated after the other person has replied', () => {
    const world = makeWorld();
    const repeatedLine = '你好，我叫林澈，我们一起寻找淡水吧。';
    startAction(world, world.agents.agent_a, { type: 'talk', target: { kind: 'agent', agentId: 'agent_b' }, text: repeatedLine });
    stepWorldMovement(world, 30);
    startAction(world, world.agents.agent_b, { type: 'talk', target: { kind: 'agent', agentId: 'agent_a' }, text: '我叫石磊，我愿意一起找。' });
    stepWorldMovement(world, 30);

    const repeatedAfterReply = startAction(world, world.agents.agent_a, { type: 'talk', target: { kind: 'agent', agentId: 'agent_b' }, text: repeatedLine });
    expect(repeatedAfterReply).toBeNull();
    expect(world.events.some((event) => event.type === 'action_rejected' && event.payload.reason === 'redundant_self_introduction')).toBe(true);
  });

  test('mutual introductions persist across completed conversations and later encounters', () => {
    const world = makeWorld();
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    startAction(world, a, { type: 'talk', target: { kind: 'agent', agentId: b.id }, text: '你好，我叫林澈，是一名救援队员。' });
    stepWorldMovement(world, 30);
    expect(b.knowledge.introducedTo).toContain(a.id);
    expect(a.knowledge.introducedTo).not.toContain(b.id);

    startAction(world, b, { type: 'talk', target: { kind: 'agent', agentId: a.id }, text: '认识你很高兴，我叫石磊。' });
    stepWorldMovement(world, 30);
    expect(a.knowledge.introducedTo).toContain(b.id);
    expect(b.knowledge.introducedTo).toContain(a.id);
    expect(a.episodicMemories.some((memory) => memory.summary.includes('石磊'))).toBe(true);

    const conversation = Object.values(world.conversations)[0];
    conversation.status = 'ended';
    conversation.updatedAt = world.gameTime;
    a.pendingConversation = undefined;
    b.pendingConversation = undefined;
    const prompt = buildPlannerMessages(world, a, []).map((message) => message.content).join('\n');
    expect(prompt).toContain('我和石磊此前已经互相介绍过');
    expect(prompt).toContain('过去的对话记录');
    expect(prompt).toContain('认识你很高兴，我叫石磊');

    b.x = 40;
    b.y = 20;
    stepWorldMovement(world, 1);
    b.x = a.x + 1;
    b.y = a.y;
    stepWorldMovement(world, 1);
    const reunion = [...world.events].reverse().find((event) => event.type === 'encounter_started' && event.targetId === b.id);
    expect(reunion?.payload.identitiesKnown).toBe(true);
    expect(a.episodicMemories.some((memory) => memory.summary.includes('再次在近处遇见了石磊'))).toBe(true);
    const reunionPrompt = buildPlannerMessages(world, a, []).map((message) => message.content).join('\n');
    expect(reunionPrompt).toContain('再次在近处遇见了石磊');
    expect(reunionPrompt.slice(reunionPrompt.indexOf('【最近发生在我身边的事】'))).not.toContain('尚未交换姓名');

    const redundant = startAction(world, a, { type: 'talk', target: { kind: 'agent', agentId: b.id }, text: '你好，我叫林澈，是一名救援队员。' });
    expect(redundant).toBeNull();
    expect(world.events.some((event) => event.type === 'action_rejected' && event.payload.reason === 'redundant_self_introduction')).toBe(true);
  });

  test('a session queues independent turns and closes at the six-turn cap', () => {
    const world = makeWorld();
    const lines = ['你还好吗？', '我还行，你呢？', '我想先看看残骸。', '我也会留意周围。', '有发现就互相告诉。', '好，先这样。'];
    for (let index = 0; index < lines.length; index++) {
      const speaker = index % 2 === 0 ? world.agents.agent_a : world.agents.agent_b;
      const target = index % 2 === 0 ? world.agents.agent_b : world.agents.agent_a;
      const action = startAction(world, speaker, { type: 'talk', target: { kind: 'agent', agentId: target.id }, text: lines[index], speechAct: index === 5 ? 'accept' : 'utterance' });
      expect(action).not.toBeNull();
      stepWorldMovement(world, 30);
    }
    const session = Object.values(world.conversations)[0];
    expect(session.status).toBe('completed');
    expect(session.turns).toHaveLength(6);
    expect(session.turns.map((turn) => turn.speakerId)).toEqual(['agent_a', 'agent_b', 'agent_a', 'agent_b', 'agent_a', 'agent_b']);
    expect(session.turns[5].speechActType).toBe('accept');
    expect(world.agents.agent_a.pendingConversation).toBeUndefined();
    expect(world.agents.agent_b.pendingConversation).toBeUndefined();
    const messages = world.events.filter((event) => event.type === 'message_spoken');
    const presentations = world.presentationEvents.filter((event) => event.kind === 'speech');
    expect(presentations).toHaveLength(6);
    expect(presentations.map((event) => event.sourceEventId)).toEqual(messages.map((event) => event.eventId));
    expect(presentations.map((event) => event.text)).toEqual(lines);
    const client = sanitizeMvp2World(world);
    expect(client.conversations[0].turns).toHaveLength(6);
    expect(client.presentationEvents.filter((event) => event.kind === 'speech').map((event) => event.text)).toEqual(lines);
  });
});
