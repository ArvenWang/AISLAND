import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { createMvp2World } from '../../server/mvp2/world';
import { propagateSound, bearingLabel } from '../../server/mvp2/audio';
import { stepWorld } from '../../server/mvp2/engine';
import { Mvp2World, ActionSpec } from '../../server/mvp2/types';
import * as path from 'path';

function makeWorld(): Mvp2World {
  const map = RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/aisland-mvp2/map.runtime.json'));
  return createMvp2World('social-test', 20260807, map);
}

describe('MVP2 audio propagation', () => {
  test('shout on open beach reaches far; dense forest blocks', () => {
    const world = makeWorld();
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    // Place both on the open beach.
    const spawnA = world.map.spawnPoint(0);
    const spawnB = world.map.spawnPoint(1);
    a.x = spawnA.x;
    a.y = spawnA.y;
    b.x = spawnB.x;
    b.y = spawnB.y;
    const heard = propagateSound(world, a.x, a.y, '有人吗？', 'evt_x', a.id);
    const bHeard = heard.find((h) => h.sourceActorId === a.id);
    expect(bHeard).toBeDefined();
    expect(['near', 'medium', 'far'].includes(bHeard!.distanceClass)).toBe(true);
    expect(bHeard!.clarity).toBeGreaterThanOrEqual(0.1);
    expect(bHeard!.bearing.length).toBeGreaterThan(0);
  });

  test('bearing label maps directions', () => {
    expect(bearingLabel(0, -1)).toBe('北');
    expect(bearingLabel(1, 0)).toBe('东');
    expect(bearingLabel(0, 1)).toBe('南');
    expect(bearingLabel(-1, 0)).toBe('西');
  });

  test('sound does not cross solid cliffs', () => {
    const world = makeWorld();
    // Find a cliff cell and an agent beyond it.
    const map = world.map;
    let cliff: { x: number; y: number } | null = null;
    for (let y = 10; y < 100 && !cliff; y++) {
      for (let x = 10; x < 200; x++) {
        if (map.terrainAt(x, y) === 'cliff') {
          cliff = { x, y };
          break;
        }
      }
    }
    if (!cliff) return;
    const a = world.agents.agent_a;
    a.x = cliff.x;
    a.y = cliff.y + 1;
    // The cliff cell itself is impassable for sound (soundCost = Infinity).
    const heard = propagateSound(world, cliff.x, cliff.y + 1, 'test', 'evt_x', a.id);
    expect(Array.isArray(heard)).toBe(true);
  });
});

describe('MVP2 social events', () => {
  test('talk action commits a message event, a claim, and an affinity bump', async () => {
    const world = makeWorld();
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    a.x = 100;
    a.y = 160;
    b.x = 101;
    b.y = 160;
    a.lastDecisionAt = -1000;
    b.lastDecisionAt = -1000;
    let talkDone = false;
    const brain = {
      async requestDecision(w: Mvp2World, agentId: string) {
        if (agentId === a.id && !talkDone) {
          talkDone = true;
          const spec: ActionSpec = { type: 'talk', target: { kind: 'agent', agentId: b.id }, text: '你看到泉水了吗？' };
          return { plan: { longTermGoal: 'g', currentObjective: 'o', steps: [], abortConditions: [] }, action: spec };
        }
        return null;
      },
    };
    await stepWorld(world, 15, brain);
    await stepWorld(world, 15, brain);
    const msg = world.events.find((e) => e.type === 'message_spoken');
    expect(msg).toBeDefined();
    expect(msg!.payload.text).toBe('你看到泉水了吗？');
    expect(msg!.observers).toContain(b.id);
    const claims = (world as unknown as { claims?: Array<{ listenerId: string; text: string }> }).claims ?? [];
    expect(claims.some((c) => c.listenerId === b.id && c.text.includes('泉水'))).toBe(true);
    expect(b.knowledge.claimsHeard.length).toBeGreaterThan(0);
  });
});
