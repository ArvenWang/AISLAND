import { computeMetrics } from '../../server/engine/metrics';
import { createWorld } from '../../server/engine/world';
import { emitEvent, resetEventCounter } from '../../server/engine/systems';

describe('Behavior metrics (25.1)', () => {
  test('classifies cooperation and competition events', () => {
    resetEventCounter();
    const { world } = createWorld('w_metrics', 'FX-BASE', {}, 'mock');
    world.agents.agent_a.inventory.water = 3;
    world.agents.agent_a.position = { x: 10, y: 10 };
    world.agents.agent_b.position = { x: 11, y: 10 };
    emitEvent(world, 'resource_given', { actorId: 'agent_a', targetId: 'agent_b', payload: { resource: 'water', amount: 1 }, observers: 'all', salience: 7 });
    emitEvent(world, 'promise_broken', { actorId: 'agent_a', targetId: 'agent_b', observers: 'all', salience: 8 });
    emitEvent(world, 'message_spoken', { actorId: 'agent_b', targetId: 'agent_a', payload: { speechActType: 'reject_request' }, observers: 'all' });
    const m = computeMetrics(world);
    expect(m.cooperationEvents.length).toBe(1);
    expect(m.competitionEvents.length).toBeGreaterThanOrEqual(2);
  });

  test('outcome class reflects survivors', () => {
    const { world } = createWorld('w_metrics2', 'FX-BASE', {}, 'mock');
    world.agents.agent_c.isAlive = false;
    const m = computeMetrics(world);
    expect(m.outcomeClass).toMatch(/two_survive|two_survive_conflict/);
  });
});
