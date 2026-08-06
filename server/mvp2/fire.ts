// Fire lifecycle: build (kindling+wood+ignition), fuel burn, states
// burning/weak/embers/out, light radius and rekindle (PRD 11.2).

import { FireEntity, Mvp2World, AgentState } from './types';

export const FIRE_REQUIREMENTS = { tinder: 1, wood: 3, lighter: 1 };

export function createFire(world: Mvp2World, agent: AgentState, x: number, y: number): { ok: boolean; reason?: string; fireId?: string } {
  if (!agent.isAlive) return { ok: false, reason: 'dead' };
  const hasTinder = (agent.inventory.tinder ?? 0) >= FIRE_REQUIREMENTS.tinder;
  const hasWood = (agent.inventory.wood ?? 0) >= FIRE_REQUIREMENTS.wood;
  const hasLighter = (agent.inventory.lighter ?? 0) >= FIRE_REQUIREMENTS.lighter;
  if (!hasTinder || !hasWood || !hasLighter) return { ok: false, reason: 'missing_materials' };
  if (world.fires && Object.values(world.fires).some((f) => f.state !== 'out' && Math.abs(f.x - x) + Math.abs(f.y - y) <= 1)) {
    return { ok: false, reason: 'fire_exists' };
  }
  agent.inventory.tinder! -= FIRE_REQUIREMENTS.tinder;
  agent.inventory.wood! -= FIRE_REQUIREMENTS.wood;
  if (agent.inventory.tinder === 0) delete agent.inventory.tinder;
  if (agent.inventory.wood === 0) delete agent.inventory.wood;
  agent.carryUsed = Object.values(agent.inventory).reduce((s, v) => s + (v ?? 0), 0);
  const fireId = `fire_${world.actionSeq++}`;
  world.fires[fireId] = {
    fireId,
    x,
    y,
    fuel: 240, // ~4 island hours
    state: 'burning',
    createdBy: agent.id,
    lastFueledBy: agent.id,
    lightRadius: 8,
  };
  world.conservationLedger.push({ gameTime: world.gameTime, itemId: fireId, kind: 'wood', delta: -FIRE_REQUIREMENTS.wood, note: 'build_fire' });
  return { ok: true, fireId };
}

export function addFuel(world: Mvp2World, agent: AgentState, fire: FireEntity, woodQty: number): { ok: boolean; reason?: string } {
  if ((agent.inventory.wood ?? 0) < woodQty) return { ok: false, reason: 'not_enough_wood' };
  if (fire.state === 'out') return { ok: false, reason: 'fire_out' };
  agent.inventory.wood = (agent.inventory.wood ?? 0) - woodQty;
  if (agent.inventory.wood === 0) delete agent.inventory.wood;
  agent.carryUsed = Object.values(agent.inventory).reduce((s, v) => s + (v ?? 0), 0);
  fire.fuel += woodQty * 80; // 80 island-minutes per wood
  fire.lastFueledBy = agent.id;
  if (fire.state === 'embers') {
    fire.state = 'weak';
    fire.lightRadius = 4;
  }
  if (fire.state === 'weak' && fire.fuel >= 60) {
    fire.state = 'burning';
    fire.lightRadius = 8;
  }
  world.conservationLedger.push({ gameTime: world.gameTime, itemId: fire.fireId, kind: 'wood', delta: -woodQty, note: 'add_fuel' });
  return { ok: true };
}

export function tickFire(world: Mvp2World, fire: FireEntity, deltaMinutes: number) {
  if (fire.state === 'out') return;
  fire.fuel -= deltaMinutes;
  if (fire.fuel <= 0) {
    fire.state = 'embers';
    fire.fuel = 0;
    fire.lightRadius = 1;
  } else if (fire.fuel < 60) {
    fire.state = 'weak';
    fire.lightRadius = 4;
  } else {
    fire.state = 'burning';
    fire.lightRadius = 8;
  }
}

export function fireStateLabel(fire: FireEntity): string {
  return fire.state === 'burning' ? '燃烧' : fire.state === 'weak' ? '火势渐弱' : fire.state === 'embers' ? '余烬' : '已熄灭';
}
