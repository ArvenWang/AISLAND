import { parsePlannerOutput, buildPlannerContext } from '../../server/llm/planner';
import { parseDialogueOutput } from '../../server/llm/dialogue';
import { createWorld } from '../../server/engine/world';

describe('Planner output parsing (21.3)', () => {
  test('accepts valid JSON', () => {
    const res = parsePlannerOutput('{"actionIndex": 2, "publicIntent": "去取水", "privateMotive": "口渴", "fallbackActionIndex": 0}');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output.actionIndex).toBe(2);
      expect(res.output.publicIntent).toBe('去取水');
    }
  });

  test('rejects invalid JSON', () => {
    const res = parsePlannerOutput('{invalid!!!');
    expect(res.ok).toBe(false);
  });

  test('rejects missing fields and negative index', () => {
    expect(parsePlannerOutput('{"actionIndex": -1, "publicIntent": "x", "privateMotive": "y"}').ok).toBe(false);
    expect(parsePlannerOutput('{"actionIndex": 0, "privateMotive": "y"}').ok).toBe(false);
  });

  test('context contains available actions with legal targets', () => {
    const { world } = createWorld('w_ctx', 'FX-BASE', {}, 'mock');
    const ctx = buildPlannerContext(world, 'agent_a');
    expect(ctx.options.length).toBeGreaterThan(0);
    expect(ctx.prompt).toContain('【可用动作】');
    expect(ctx.prompt).toContain('口渴度');
  });
});

describe('Dialogue output parsing', () => {
  test('accepts valid speech acts', () => {
    const res = parseDialogueOutput(
      '{"initiatorMessage": {"type": "request_resource", "text": "给我水", "resource": "water", "amount": 1}, "responderMessages": [{"type": "accept_request", "text": "好"}]}',
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output.initiatorMessage.resource).toBe('water');
      expect(res.output.responderMessages.length).toBe(1);
    }
  });

  test('rejects non-whitelisted speech acts', () => {
    const res = parseDialogueOutput(
      '{"initiatorMessage": {"type": "teleport", "text": "x"}, "responderMessages": [{"type": "social_chat", "text": "y"}]}',
    );
    expect(res.ok).toBe(false);
  });
});
