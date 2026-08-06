// DEV-ONLY scripted brain for P3 engine integration tests. It is replaced by
// the real LLM planner in P4 and must not appear in the production player
// path (production only instantiates RealLlmAdapter brains).

import { Mvp2World, ActionSpec, AgentState } from './types';
import { findPath } from '../engine/map/pathGrid';
import { AgentBrain } from './engine';

export class ScriptedSurvivalBrain implements AgentBrain {
  constructor(private rng: () => number = () => 0.5) {}

  async requestDecision(world: Mvp2World, agentId: string): Promise<{ plan: unknown; action: ActionSpec } | null> {
    const agent = world.agents[agentId];
    if (!agent || !agent.isAlive) return null;
    const act = this.pick(world, agent);
    return { plan: { longTermGoal: 'survive', currentObjective: 'stay alive', exploration: { mode: 'head_inland', approximateBearing: 0 } }, action: act };
  }

  private pick(world: Mvp2World, agent: AgentState): ActionSpec {
    const light = (world.gameTime % 1440);
    const night = light >= 1140 || light < 360;
    // Urgent needs.
    if (agent.needs.water < 35 && (agent.inventory.water ?? 0) > 0) {
      return { type: 'consume', target: { kind: 'none' }, itemKind: 'water', amount: 1 };
    }
    if (agent.needs.food < 35 && (agent.inventory.food ?? 0) > 0) {
      return { type: 'consume', target: { kind: 'none' }, itemKind: 'food', amount: 1 };
    }
    // Pick up visible items when below capacity.
    const visibleItems = Object.values(world.groundItems).filter((g) => agent.cognitive.visible[g.y * world.map.width + g.x]);
    if (visibleItems.length && agent.carryUsed < 9) {
      const item = visibleItems.sort((a, b) => Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) - (Math.abs(b.x - agent.x) + Math.abs(b.y - agent.y)))[0];
      if (Math.abs(item.x - agent.x) + Math.abs(item.y - agent.y) <= 2) {
        return { type: 'pickup_item', target: { kind: 'item', itemId: item.itemId } };
      }
      const path = findPath(world.map, { x: agent.x, y: agent.y }, { x: item.x, y: item.y }, { allowed: (x, y) => agent.cognitive.explored[y * world.map.width + x] === 1 });
      if (path) return { type: 'move', target: { kind: 'cell', x: item.x, y: item.y }, path };
    }
    // Known resource with stock -> harvest (if close) or go there.
    const known = agent.knowledge.knownResources.map((id) => world.resources[id]).filter((r) => r && r.stock > 0);
    if (known.length) {
      const r = known.sort((a, b) => Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) - (Math.abs(b.x - agent.x) + Math.abs(b.y - agent.y)))[0];
      if (Math.abs(r.x - agent.x) + Math.abs(r.y - agent.y) <= 2) {
        const type = r.kind === 'spring' ? 'harvest_water' : r.kind === 'berry_bush' ? 'harvest_food' : 'harvest_wood';
        return { type, target: { kind: 'resource', resourceId: r.resourceId }, amount: 1 };
      }
      const path = findPath(world.map, { x: agent.x, y: agent.y }, { x: r.x, y: r.y }, { allowed: (x, y) => agent.cognitive.explored[y * world.map.width + x] === 1 });
      if (path) return { type: 'move', target: { kind: 'cell', x: r.x, y: r.y }, path };
    }
    // Sleep at night if tired; rest when exhausted.
    if (night && agent.needs.sleepNeed > 55) return { type: 'sleep', target: { kind: 'none' } };
    if (agent.needs.stamina < 25) return { type: 'rest', target: { kind: 'none' }, durationMinutes: 90 };
    // Explore unknown frontier.
    return { type: 'explore', target: { kind: 'direction', bearingDeg: 0 } };
  }
}
