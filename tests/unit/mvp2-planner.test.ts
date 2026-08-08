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
