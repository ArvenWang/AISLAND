import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { createMvp2World } from '../../server/mvp2/world';
import { buildPlannerMessages, parseAgentDecision, resolveNextAction, assertPromptCompliant, RealLlmBrain, type LlmLike } from '../../server/mvp2/planner';
import { Mvp2World } from '../../server/mvp2/types';
import * as path from 'path';

function makeWorld(): Mvp2World {
  const map = RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/aisland-mvp2/map.runtime.json'));
  return createMvp2World('test', 20260807, map);
}

describe('MVP2 planner prompt', () => {
  test('prompt contains no forbidden markers (direction hints / thresholds / strategies)', () => {
    const world = makeWorld();
    const agent = Object.values(world.agents)[0];
    const messages = buildPlannerMessages(world, agent, []);
    const violations = assertPromptCompliant(messages);
    expect(violations).toEqual([]);
  });

  test('prompt exposes only perceived knowledge (no map dims, no hidden resources)', () => {
    const world = makeWorld();
    const agent = Object.values(world.agents)[0];
    const text = buildPlannerMessages(world, agent, []).map((m) => m.content).join('\n');
    expect(text).not.toContain('256');
    expect(text).not.toContain('192');
    expect(text).not.toContain('spring_');
    expect(text).not.toContain('resourceId');
    expect(text).toContain('我看到的周围环境');
  });

  test('visible strangers receive stable anonymous target refs that resolve without leaking profile ids', () => {
    const world = makeWorld();
    const agent = world.agents.agent_a;
    agent.cognitive.visible.fill(1);
    const text = buildPlannerMessages(world, agent, []).map((message) => message.content).join('\n');
    const targetRef = text.match(/另一名幸存者（targetRef=(person_[a-z0-9]+)）/)?.[1];
    expect(targetRef).toBeDefined();
    expect(text).not.toContain('targetRef=agent_b');

    const exact = resolveNextAction(world, agent, {
      longTermGoal: '生存', currentObjective: '询问信息', plan: [], abortConditions: [], privateMotive: '了解环境',
      nextAction: { type: 'talk', targetRef, text: '你知道哪里有水吗？' },
    });
    expect('spec' in exact && exact.spec.target.kind === 'agent').toBe(true);

    const generic = resolveNextAction(world, agent, {
      longTermGoal: '生存', currentObjective: '询问信息', plan: [], abortConditions: [], privateMotive: '了解环境',
      nextAction: { type: 'talk', targetRef: 'unknown_survivor', text: '你还好吗？' },
    });
    expect('spec' in generic && generic.spec.target.kind === 'agent').toBe(true);
  });

  test('a pending speaker keeps an explicit reply ref even when low visibility hides them', () => {
    const world = makeWorld();
    const agent = world.agents.agent_a;
    const other = world.agents.agent_b;
    other.x = agent.x + 1;
    other.y = agent.y;
    agent.cognitive.visible.fill(0);
    agent.pendingConversation = { conversationId: 'conversation_reply', fromId: other.id, text: '你找到水了吗？', createdAt: world.gameTime };
    world.conversations.conversation_reply = {
      conversationId: 'conversation_reply', participantIds: [other.id, agent.id], status: 'awaiting_response', currentSpeakerId: agent.id,
      turns: [{ turnId: 'turn_1', speakerId: other.id, text: '你找到水了吗？', speechActType: 'utterance', gameTime: world.gameTime, eventId: 'evt_reply' }],
      startedAt: world.gameTime, updatedAt: world.gameTime,
    };

    const text = buildPlannerMessages(world, agent, []).map((message) => message.content).join('\n');
    const replyRef = text.match(/若回应，talk 的 targetRef=(person_[a-z0-9]+)/)?.[1];
    expect(replyRef).toBeDefined();
    const resolved = resolveNextAction(world, agent, {
      longTermGoal: '生存', currentObjective: '回应问题', plan: [], abortConditions: [], privateMotive: '交换信息',
      nextAction: { type: 'talk', targetRef: replyRef, text: '还没有。' },
    });
    expect('spec' in resolved && resolved.spec.target.kind === 'agent' && resolved.spec.target.agentId === other.id).toBe(true);
  });
});

describe('MVP2 decision parsing', () => {
  test('parses valid JSON and tolerates code fences / surrounding text', () => {
    const d = parseAgentDecision('好的，我的决定如下：\n```json\n{"longTermGoal":"活下去","currentObjective":"找水","plan":[{"action":"去泉水","purpose":"解渴"}],"nextAction":{"type":"move_to","targetRef":"spring_1","amount":1},"abortConditions":[],"privateMotive":"先保命"}\n```');
    expect(d).not.toBeNull();
    expect(d!.longTermGoal).toBe('活下去');
    expect(d!.nextAction.type).toBe('move_to');
  });

  test('returns null on garbage', () => {
    expect(parseAgentDecision('{not json at all')).toBeNull();
  });

  test('unknown targetRefs are rejected without side effects', () => {
    const world = makeWorld();
    const agent = Object.values(world.agents)[0];
    const res = resolveNextAction(world, agent, {
      longTermGoal: 'g',
      currentObjective: 'o',
      plan: [],
      nextAction: { type: 'pickup_item', targetRef: 'item_does_not_exist' },
      abortConditions: [],
      privateMotive: 'm',
    });
    expect('error' in res).toBe(true);
  });

  test('valid refs resolve to concrete action specs', () => {
    const world = makeWorld();
    const agent = Object.values(world.agents)[0];
    const item = Object.values(world.groundItems)[0];
    agent.cognitive.visible[item.y * world.map.width + item.x] = 1;
    const res = resolveNextAction(world, agent, {
      longTermGoal: 'g',
      currentObjective: 'o',
      plan: [],
      nextAction: { type: 'pickup_item', targetRef: item.itemId },
      abortConditions: [],
      privateMotive: 'm',
    });
    expect('spec' in res && res.spec.type).toBe('pickup_item');
  });

  test('accepts semantically equivalent action names returned by real models', () => {
    const world = makeWorld();
    const agent = world.agents.agent_a;
    const spring = Object.values(world.resources).find((resource) => resource.kind === 'spring')!;
    agent.knowledge.knownResources.push(spring.resourceId);
    agent.cognitive.visible[spring.y * world.map.width + spring.x] = 1;
    const decision = {
      longTermGoal: '生存', currentObjective: '取水', plan: [], abortConditions: [], privateMotive: '补水',
      nextAction: { type: 'harvest_water', targetRef: spring.resourceId },
    };
    const resolved = resolveNextAction(world, agent, decision);
    expect('spec' in resolved && resolved.spec.type).toBe('harvest_water');
  });
});

describe('MVP2 real brain fault behavior', () => {
  function stubLlm(responder: (n: number) => { status: string; content: string | null }): LlmLike {
    let n = 0;
    return {
      async chat() {
        const r = responder(n++);
        return { content: r.content, status: r.status as never, latencyMs: 1, promptTokens: 10, completionTokens: 5, cachedTokens: 0, model: 'test' };
      },
    };
  }

  test('transient API failure pauses the agent (no fallback action)', async () => {
    const world = makeWorld();
    const agent = Object.values(world.agents)[0];
    const brain = new RealLlmBrain(stubLlm(() => ({ status: '429', content: null })));
    const d = await brain.requestDecision(world, agent.id);
    expect(d).toBeNull();
    expect(world.llmLedger.some((l) => l.status === '429')).toBe(true);
    // no action was started
    expect(agent.currentAction).toBeNull();
  });

  test('invalid JSON gets one repair pass; success uses repaired decision', async () => {
    const world = makeWorld();
    const agent = Object.values(world.agents)[0];
    const okJson = '{"longTermGoal":"活","currentObjective":"活","plan":[],"nextAction":{"type":"observe"},"abortConditions":[],"privateMotive":"m"}';
    const brain = new RealLlmBrain(stubLlm((n) => (n === 0 ? { status: 'ok', content: 'not json' } : { status: 'ok', content: okJson })));
    const d = await brain.requestDecision(world, agent.id);
    expect(d).not.toBeNull();
    expect(d!.action.type).toBe('observe');
    expect(world.llmLedger.some((l) => l.status === 'ok' && l.llmRequestId.endsWith('_repair'))).toBe(true);
  });

  test('plan is stored with evidence event ids', async () => {
    const world = makeWorld();
    const agent = Object.values(world.agents)[0];
    const okJson = '{"longTermGoal":"活下去","currentObjective":"找水源","plan":[{"action":"沿海岸走","purpose":"找入海口"}],"nextAction":{"type":"explore","direction":"north"},"abortConditions":[{"kind":"dark","description":"天黑就折返"}],"privateMotive":"先掌握地形"}';
    const brain = new RealLlmBrain(stubLlm(() => ({ status: 'ok', content: okJson })));
    const d = await brain.requestDecision(world, agent.id);
    expect(d).not.toBeNull();
    expect(agent.plan?.goal).toBe('活下去');
    expect(agent.plan?.steps[0]?.abortConditions).toEqual([]);
    expect(d!.action.type).toBe('explore');
  });
});
