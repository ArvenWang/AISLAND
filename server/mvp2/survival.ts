// Needs decay, consumption, sleep, and minimal mental state (PRD 11, 12).
// Decay is deterministic and server-side; agents only see descriptions.

import { AgentState, ItemKind, Mvp2World } from './types';
import { compileMechanics, getProfile } from '../engine/profile';
import { carryCapacity, carryUsed } from './items';

export const NEED_RATES = {
  waterPerIslandHour: 1.6,
  foodPerIslandHour: 1.1,
  staminaRestPerIslandHour: 18,
  staminaWalkPerIslandHour: 5,
};

export function tickNeeds(agent: AgentState, deltaMinutes: number, moving: boolean, sleeping: boolean, fireNearby: boolean) {
  if (!agent.isAlive) return;
  const h = deltaMinutes / 60;
  const mechanics = compileMechanics(getProfile(agent.profileId));
  const needsRate = mechanics.needRateMultiplier;
  agent.needs.water = Math.max(0, agent.needs.water - NEED_RATES.waterPerIslandHour * h * needsRate * (agent.needs.stamina < 20 ? 1.25 : 1));
  agent.needs.food = Math.max(0, agent.needs.food - NEED_RATES.foodPerIslandHour * h * needsRate);
  if (sleeping) {
    agent.needs.stamina = Math.min(100, agent.needs.stamina + NEED_RATES.staminaRestPerIslandHour * h * (fireNearby ? 1.6 : 1));
    agent.needs.sleepNeed = Math.max(0, agent.needs.sleepNeed - 26 * h);
  } else {
    const loadRatio = Math.min(1.5, carryUsed(agent) / Math.max(1, carryCapacity(null, agent)));
    const loadCost = moving ? 1 + Math.max(0, loadRatio - 0.5) * 0.8 : 1;
    agent.needs.stamina = Math.max(0, agent.needs.stamina - (moving ? NEED_RATES.staminaWalkPerIslandHour * mechanics.staminaCostMultiplier * loadCost : 1.1) * h);
    agent.needs.sleepNeed = Math.min(100, agent.needs.sleepNeed + 10 * h);
  }
  // Health: extreme thirst/hunger damages; stamina recovery helps slowly.
  if (agent.needs.water <= 0) agent.needs.health = Math.max(0, agent.needs.health - 8 * h);
  else if (agent.needs.water < 15) agent.needs.health = Math.max(0, agent.needs.health - 3 * h);
  if (agent.needs.food <= 0) agent.needs.health = Math.max(0, agent.needs.health - 5 * h);
  else if (agent.needs.food < 15) agent.needs.health = Math.max(0, agent.needs.health - 2 * h);
  if (agent.needs.water > 40 && agent.needs.food > 40 && agent.needs.stamina > 30 && agent.needs.health < 100) {
    agent.needs.health = Math.min(100, agent.needs.health + 1.5 * h);
  }
  if (agent.needs.health <= 0) {
    agent.isAlive = false;
    agent.needs.health = 0;
  }
}

export function consume(world: Mvp2World, agent: AgentState, kind: ItemKind, amount: number): { ok: boolean; reason?: string } {
  if (!agent.isAlive) return { ok: false, reason: 'dead' };
  const have = agent.inventory[kind] ?? 0;
  if (have < amount) return { ok: false, reason: 'not_enough' };
  agent.inventory[kind] = have - amount;
  if (agent.inventory[kind] === 0) delete agent.inventory[kind];
  agent.carryUsed = Object.values(agent.inventory).reduce((s, v) => s + (v ?? 0), 0);
  if (kind === 'water') agent.needs.water = Math.min(100, agent.needs.water + 22 * amount);
  if (kind === 'food') agent.needs.food = Math.min(100, agent.needs.food + 18 * amount);
  agent.stats.consumed[kind] = (agent.stats.consumed[kind] ?? 0) + amount;
  world.conservationLedger.push({ gameTime: world.gameTime, itemId: `${agent.id}:${kind}`, kind, delta: -amount, note: 'consume' });
  return { ok: true };
}

export function startSleep(agent: AgentState, gameTime: number, comfort: number, fireNearby: boolean): { ok: boolean; reason?: string } {
  if (!agent.isAlive) return { ok: false, reason: 'dead' };
  if (agent.sleep) return { ok: false, reason: 'already_sleeping' };
  agent.sleep = { sleeping: true, since: gameTime, comfort, fireNearby };
  return { ok: true };
}

export function wakeUp(agent: AgentState, reason = 'woke_up'): boolean {
  void reason;
  if (!agent.sleep) return false;
  agent.sleep = null;
  return true;
}

export function tickMental(agent: AgentState, deltaMinutes: number, lightLevel: 'day' | 'dusk' | 'night', socialNearby: boolean, fireNearby: boolean, corpseVisible: boolean) {
  if (!agent.isAlive) return;
  const h = deltaMinutes / 60;
  let stability = 0;
  if (lightLevel === 'night') stability -= 1.6 * h;
  else if (lightLevel === 'dusk') stability -= 0.6 * h;
  if (corpseVisible) stability -= 2.2 * h;
  if (agent.needs.sleepNeed > 85) stability -= 1.2 * h;
  if (agent.needs.health < 25) stability -= 1.0 * h;
  if (fireNearby) stability += 1.8 * h;
  if (socialNearby) stability += 0.8 * h;
  if (agent.sleep?.sleeping) stability += 2.0 * h;
  agent.mental.mentalStability = Math.max(0, Math.min(100, agent.mental.mentalStability + stability));
  agent.mental.fear = Math.max(0, Math.min(100, agent.mental.fear + (lightLevel === 'night' ? 1.4 * h : -0.8 * h) + (agent.needs.health < 20 ? 0.8 * h : 0) + (fireNearby ? -1.2 * h : 0)));
  agent.mental.socialSafety = Math.max(0, Math.min(100, agent.mental.socialSafety + (socialNearby ? 1.0 * h : -0.4 * h)));
}

export function startSleepAt(world: Mvp2World, agent: AgentState): void {
  const fireNearby = Object.values(world.fires).some((f) => f.state !== 'out' && Math.abs(f.x - agent.x) + Math.abs(f.y - agent.y) <= 4);
  const comfort = fireNearby ? 1 : agent.cognitive.familiarityNear(agent.x, agent.y) > 0.5 ? 0.8 : 0.45;
  startSleep(agent, world.gameTime, comfort, fireNearby);
}
