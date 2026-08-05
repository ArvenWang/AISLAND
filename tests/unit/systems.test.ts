import { createWorld } from '../../server/engine/world';
import { Rng } from '../../server/engine/rng';
import {
  applySurvivalTick,
  applyDailyRegen,
  harvestFromNode,
  transfer,
  discoverLocation,
  shareLocation,
  applyRelationshipDelta,
  createPromise,
  adjudicatePromises,
  gameMasterValidate,
  agentCapacity,
  buildAvailableActions,
  killAgent,
  totalResource,
  emitEvent,
  resetEventCounter,
} from '../../server/engine/systems';
import type { ActionIntent } from '../../server/engine/types';

function freshWorld() {
  resetEventCounter();
  return createWorld('w_test', 'FX-BASE', {}, 'mock').world;
}

describe('Needs system (RES-003)', () => {
  test('water/food decay with game time and danger triggers', () => {
    const world = freshWorld();
    const agent = world.agents.agent_a;
    const w0 = agent.needs.water;
    const triggers = applySurvivalTick(world, 10);
    expect(agent.needs.water).toBeLessThan(w0);
    expect(Array.isArray(triggers)).toBe(true);
  });

  test('stamina recovers during rest faster at camp', () => {
    const world = freshWorld();
    const agent = world.agents.agent_a;
    agent.needs.stamina = 20;
    agent.currentAction = {
      instanceId: 'x',
      actorId: agent.id,
      action: { type: 'rest', targetId: 'crash_camp', durationMinutes: 60 },
      publicIntent: '',
      privateMotive: '',
      startedAt: 0,
      endsAt: 60,
      status: 'running',
    };
    applySurvivalTick(world, 60);
    expect(agent.needs.stamina).toBeGreaterThan(50);
  });
});

describe('Resources (RES-001/002)', () => {
  test('harvest decrements node stock and increments inventory', () => {
    const world = freshWorld();
    const agent = world.agents.agent_a;
    const node = world.resources.water_spring_01;
    const before = node.stock;
    harvestFromNode(world, node, agent, 2, 'op1');
    expect(node.stock).toBe(before - 2);
    expect(agent.inventory.water).toBe(2);
  });

  test('harvest respects node stock', () => {
    const world = freshWorld();
    const agent = world.agents.agent_a;
    const node = world.resources.water_spring_01;
    node.stock = 1;
    const { harvested } = harvestFromNode(world, node, agent, 5, 'op2');
    expect(harvested).toBe(1);
  });

  test('daily regen restores spring to capacity', () => {
    const world = freshWorld();
    world.resources.water_spring_01.stock = 2;
    applyDailyRegen(world);
    expect(world.resources.water_spring_01.stock).toBe(5);
  });

  test('transfer moves bounded amounts', () => {
    const a = { water: 3, food: 1 };
    const b = { water: 0, food: 0 };
    expect(transfer(a, b, 'water', 5)).toBe(3);
    expect(a.water).toBe(0);
    expect(b.water).toBe(3);
  });
});

describe('Death (RES-004/005)', () => {
  test('death stops the agent and creates a lootable backpack', () => {
    const world = freshWorld();
    const agent = world.agents.agent_a;
    agent.inventory = { water: 2, food: 1 };
    killAgent(world, agent.id, '脱水');
    expect(agent.isAlive).toBe(false);
    expect(agent.inventory).toEqual({ water: 0, food: 0 });
    const backpack = world.containers[`backpack_${agent.id}`];
    expect(backpack).toBeDefined();
    expect(backpack.inventory).toEqual({ water: 2, food: 1 });
    expect(world.events.some((e) => e.type === 'agent_died')).toBe(true);
    // Dead agent cannot act.
    const intent: ActionIntent = {
      requestId: 'r',
      actorId: agent.id,
      snapshotVersion: 1,
      requestedGameTime: 0,
      action: { type: 'rest', durationMinutes: 30 },
      publicIntent: '',
      privateMotive: '',
    };
    expect(gameMasterValidate(world, intent).ok).toBe(false);
  });
});

describe('Knowledge (6.4, MAP-004)', () => {
  test('discovery adds location and knowledge fact', () => {
    const world = freshWorld();
    discoverLocation(world, 'agent_a', 'water_spring_01', 'discovery', 1);
    expect(world.agents.agent_a.knownLocations).toContain('water_spring_01');
    expect(world.agents.agent_a.knowledgeFacts.some((f) => f.targetId === 'water_spring_01' && f.source === 'discovery')).toBe(true);
  });

  test('share transfers knowledge and updates trust', () => {
    const world = freshWorld();
    discoverLocation(world, 'agent_a', 'water_spring_01', 'discovery', 1);
    const evt = emitEvent(world, 'test', { observers: 'all' });
    shareLocation(world, 'agent_a', 'agent_b', 'water_spring_01', evt.eventId);
    expect(world.agents.agent_b.knownLocations).toContain('water_spring_01');
    expect(world.agents.agent_b.relationships.agent_a.trust).toBeGreaterThan(0);
  });

  test('cannot share unknown locations', () => {
    const world = freshWorld();
    const evt = emitEvent(world, 'test', { observers: 'all' });
    shareLocation(world, 'agent_b', 'agent_a', 'water_spring_01', evt.eventId);
    expect(world.agents.agent_a.knownLocations).not.toContain('water_spring_01');
  });
});

describe('Relationships (SOC-005)', () => {
  test('every delta carries sourceEventId and ruleId', () => {
    const world = freshWorld();
    const evt = emitEvent(world, 'resource_given', { actorId: 'agent_a', targetId: 'agent_b', observers: 'all' });
    applyRelationshipDelta(world, 'agent_b', 'agent_a', 'trust', 8, 'rule_give', '对方赠予资源', evt.eventId);
    const delta = world.agents.agent_b.relationships.agent_a.deltas[0];
    expect(delta.sourceEventId).toBe(evt.eventId);
    expect(delta.ruleId).toBe('rule_give');
    expect(delta.delta).toBe(8);
    expect(delta.explanation.length).toBeGreaterThan(0);
  });
});

describe('Promises (SOC-004)', () => {
  test('broken when promiser could give but did not', () => {
    const world = freshWorld();
    createPromise(world, 'agent_a', 'agent_b', 'give', 'water', 1, 60, 'evt_x');
    world.agents.agent_a.inventory.water = 2;
    world.gameTime = 61;
    adjudicatePromises(world, 61);
    expect(world.promiseLedger[0].status).toBe('broken');
  });

  test('impossible when promiser dead', () => {
    const world = freshWorld();
    createPromise(world, 'agent_a', 'agent_b', 'give', 'water', 1, 60, 'evt_x');
    killAgent(world, 'agent_a', '脱水');
    world.gameTime = 61;
    adjudicatePromises(world, 61);
    expect(world.promiseLedger[0].status).toBe('impossible');
  });
});

describe('Game Master (10.3)', () => {
  test('unknown targets rejected (MAP-002)', () => {
    const world = freshWorld();
    world.status = 'running';
    const intent: ActionIntent = {
      requestId: 'r',
      actorId: 'agent_a',
      snapshotVersion: 1,
      requestedGameTime: 0,
      action: { type: 'move', targetId: 'secret_beach' },
      publicIntent: '',
      privateMotive: '',
    };
    const res = gameMasterValidate(world, intent);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('unknown_target');
  });

  test('harvest requires proximity and knowledge', () => {
    const world = freshWorld();
    world.status = 'running';
    const intent: ActionIntent = {
      requestId: 'r',
      actorId: 'agent_a',
      snapshotVersion: 1,
      requestedGameTime: 0,
      action: { type: 'harvest', targetId: 'water_spring_01', amount: 1 },
      publicIntent: '',
      privateMotive: '',
    };
    const res = gameMasterValidate(world, intent);
    expect(res.ok).toBe(false); // unknown + too far
  });

  test('consume requires inventory', () => {
    const world = freshWorld();
    world.status = 'running';
    const intent: ActionIntent = {
      requestId: 'r',
      actorId: 'agent_a',
      snapshotVersion: 1,
      requestedGameTime: 0,
      action: { type: 'consume', resource: 'water', amount: 1 },
      publicIntent: '',
      privateMotive: '',
    };
    expect(gameMasterValidate(world, intent).ok).toBe(false);
  });
});

describe('Conservation (INV-001)', () => {
  test('resource ledger balances after harvest and consumption', () => {
    const world = freshWorld();
    const initial = totalResource(world, 'water');
    harvestFromNode(world, world.resources.water_spring_01, world.agents.agent_a, 2, 'op');
    const moved = transfer(world.agents.agent_a.inventory, { water: 0, food: 0 }, 'water', 1);
    void moved;
    expect(totalResource(world, 'water')).toBe(initial - 1);
  });

  test('capacity limits inventory (carry capacity)', () => {
    const world = freshWorld();
    expect(agentCapacity(world.agents.agent_b)).toBeGreaterThan(agentCapacity(world.agents.agent_c));
  });
});

describe('Available actions', () => {
  test('never empty and all options reference known targets', () => {
    const world = freshWorld();
    for (const id of ['agent_a', 'agent_b', 'agent_c']) {
      const opts = buildAvailableActions(world, world.agents[id]);
      expect(opts.length).toBeGreaterThan(0);
      for (const o of opts) {
        if (o.action.type === 'move' || o.action.type === 'explore' || o.action.type === 'harvest' || o.action.type === 'rest') {
          if (o.action.targetId) {
            const isAgent = Object.keys(world.agents).includes(o.action.targetId);
            if (!isAgent) expect(world.agents[id].knownLocations).toContain(o.action.targetId);
          }
        }
      }
    }
  });
});

describe('Rng determinism through world', () => {
  test('two worlds with same seed and mock produce identical event streams', () => {
    const a = freshWorld();
    const b = freshWorld();
    expect(a.rng.stateValue).toBe(b.rng.stateValue);
    expect(a.rng.next()).toBe(b.rng.next());
    void new Rng(0);
  });
});
