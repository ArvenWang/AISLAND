// Deterministic simulation systems: needs, resources, inventory, events,
// knowledge, perception, relationships, promises, GameMaster, action system.

import { compileMechanics, getProfile } from './profile';
import { findPath, tileDistance } from './map';
import { MINUTES_PER_DAY, formatGameTime, parseGameTimeString } from './scenario';
import type {
  Action,
  ActionInstance,
  ActionIntent,
  AgentState,
  Container,
  Conversation,
  Inventory,
  RelationshipDelta,
  ResourceNode,
  SpeechAct,
  ValidatedAction,
  WorldEvent,
  WorldState,
} from './types';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

let eventCounter = 0;

export function resetEventCounter() {
  eventCounter = 0;
}

export function emitEvent(
  world: WorldState,
  type: string,
  opts: {
    actorId?: string;
    targetId?: string;
    locationId?: string;
    payload?: Record<string, unknown>;
    salience?: number;
    observers?: string[] | 'all';
    sourceOperationId?: string;
  } = {},
): WorldEvent {
  eventCounter += 1;
  const event: WorldEvent = {
    eventId: `evt_${String(eventCounter).padStart(4, '0')}`,
    worldId: world.worldId,
    worldVersion: world.worldVersion,
    gameTime: world.gameTime,
    type,
    actorId: opts.actorId,
    targetId: opts.targetId,
    locationId: opts.locationId,
    payload: opts.payload ?? {},
    observers:
      opts.observers === 'all'
        ? Object.keys(world.agents)
        : opts.observers ??
          resolveObservers(
            world,
            opts.locationId ? targetPos(world, opts.locationId) : world.agents[opts.actorId ?? '']?.position,
          ),
    salience: opts.salience ?? 5,
    sourceOperationId: opts.sourceOperationId,
  };
  world.events.push(event);
  // Inject into observers' recent event windows (for memory injection).
  for (const oid of event.observers) {
    const a = world.agents[oid];
    if (a) {
      a.recentEvents.push(event.eventId);
      if (a.recentEvents.length > 14) a.recentEvents.shift();
    }
  }
  return event;
}

function resolveObservers(world: WorldState, at?: { x: number; y: number }): string[] {
  if (!at) return Object.keys(world.agents);
  const out: string[] = [];
  for (const a of Object.values(world.agents)) {
    if (a.isAlive && tileDistance(a.position, at) <= 7) out.push(a.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Needs (RES-003)
// ---------------------------------------------------------------------------

export type NeedChange = { agentId: string; reason: string };

export function applySurvivalTick(world: WorldState, dtMinutes: number): NeedChange[] {
  const triggers: NeedChange[] = [];
  for (const agent of Object.values(world.agents)) {
    if (!agent.isAlive) continue;
    const profile = getProfile(agent.profileId);
    const mech = compileMechanics(profile);
    const needMul = mech.needRateMultiplier * (world.scenario.initialConditions.accelerateNeedsFor === agent.id ? 1.9 : 1);
    const waterPerDay = world.scenario.initialConditions.waterNeedPerDay;
    const foodPerDay = world.scenario.initialConditions.foodNeedPerDay;
    const dtDays = dtMinutes / MINUTES_PER_DAY;
    const prevWater = agent.needs.water;
    const prevFood = agent.needs.food;
    agent.needs.water = clamp(agent.needs.water - waterPerDay * 25 * dtDays * needMul, 0, 100);
    agent.needs.food = clamp(agent.needs.food - foodPerDay * 40 * dtDays * needMul, 0, 100);

    // Stamina: resting recovers, actions drain.
    const action = agent.currentAction;
    const resting = action?.action.type === 'rest';
    if (resting) {
      const atCamp = action?.action.type === 'rest' && action.action.targetId === 'crash_camp';
      agent.needs.stamina = clamp(agent.needs.stamina + (atCamp ? 38 : 22) * dtMinutes / 60, 0, 100);
    } else if (action && ['move', 'explore', 'harvest', 'loot_backpack'].includes(action.action.type)) {
      // drain handled at action settlement; small idle drain here
      agent.needs.stamina = clamp(agent.needs.stamina - 1.2 * dtMinutes / 60 * mech.staminaCostMultiplier, 0, 100);
    } else {
      agent.needs.stamina = clamp(agent.needs.stamina + 2 * dtMinutes / 60, 0, 100);
    }

    // Health.
    const hpPerHour = (agent.needs.water <= 0 ? -3 : 0) + (agent.needs.food <= 0 ? -2 : 0) + (agent.needs.water > 50 && agent.needs.food > 50 ? 0.4 : 0);
    agent.needs.health = clamp(agent.needs.health + (hpPerHour * dtMinutes) / 60, 0, 100);

    // Dynamic states.
    agent.stress = clamp(Math.round(agent.stress + (agent.needs.water < 25 ? 1.5 : -0.3) * dtMinutes / 60), 0, 100);
    agent.desperation = clamp(Math.round(agent.desperation + (agent.needs.water < 10 || agent.needs.food < 10 ? 2 : -0.2) * dtMinutes / 60), 0, 100);
    agent.perceivedScarcity = clamp(
      Math.round(
        agent.perceivedScarcity +
          ((agent.inventory.water + agent.inventory.food < 2 ? 1.2 : -0.2) + (agent.needs.water < 20 ? 0.8 : 0)) * dtMinutes / 60,
      ),
      0,
      100,
    );

    if (agent.needs.health <= 0) {
      killAgent(world, agent.id, agent.needs.water <= 0 ? '脱水' : agent.needs.food <= 0 ? '饥饿' : '体力衰竭');
      triggers.push({ agentId: agent.id, reason: 'died' });
      continue;
    }

    // Danger thresholds trigger replanning (8.3).
    const crossedWater = prevWater >= 25 && agent.needs.water < 25;
    const crossedFood = prevFood >= 25 && agent.needs.food < 25;
    const crossedHealth = agent.needs.health < 30 && prevWater >= 30;
    if (crossedWater || crossedFood || crossedHealth || agent.needs.stamina <= 12) {
      triggers.push({ agentId: agent.id, reason: crossedWater ? 'water_danger' : crossedFood ? 'food_danger' : 'health_danger' });
    }
  }
  return triggers;
}

// ---------------------------------------------------------------------------
// Death (RES-004/RES-005)
// ---------------------------------------------------------------------------

export function killAgent(world: WorldState, agentId: string, cause: string) {
  const agent = world.agents[agentId];
  if (!agent || !agent.isAlive) return;
  agent.isAlive = false;
  agent.deathTime = world.gameTime;
  agent.currentAction = undefined;
  // Drop inventory into a corpse backpack at the death position.
  const backpack: Container = {
    id: `backpack_${agentId}`,
    kind: 'corpse_backpack',
    position: { ...agent.position },
    inventory: { ...agent.inventory },
    ownerId: agentId,
  };
  world.containers[backpack.id] = backpack;
  agent.inventory = { water: 0, food: 0 };
  const evt = emitEvent(world, 'agent_died', {
    actorId: agentId,
    locationId: undefined,
    payload: { cause, backpackId: backpack.id, dropped: backpack.inventory },
    salience: 10,
    observers: resolveObservers(world, backpack.position),
  });
  // Adjudicate any promises where this agent is promiser/recipient.
  adjudicatePromises(world, world.gameTime);
  void evt;
}

// ---------------------------------------------------------------------------
// Resources (RES-001/RES-002)
// ---------------------------------------------------------------------------

export function applyDailyRegen(world: WorldState) {
  for (const node of Object.values(world.resources)) {
    if (node.regenRule === 'restore_to_capacity_daily') {
      const before = node.stock;
      node.stock = Math.min(node.capacity, node.stock + (node.regenAmount ?? node.capacity));
      const gained = node.stock - before;
      if (gained > 0) {
        emitEvent(world, 'resource_regen', {
          locationId: node.id,
          payload: { resource: node.resource, amount: gained, stockBefore: before, stockAfter: node.stock },
          salience: 3,
          observers: 'all',
        });
      }
    }
  }
  emitEvent(world, 'daily_regen', { payload: { message: '清晨资源恢复' }, salience: 2, observers: 'all' });
}

export function harvestFromNode(
  world: WorldState,
  node: ResourceNode,
  agent: AgentState,
  requested: number,
  sourceOperationId?: string,
): { harvested: number; failed: boolean } {
  const profile = getProfile(agent.profileId);
  const mech = compileMechanics(profile);
  let amount = Math.min(requested, node.stock);
  let failed = false;
  if (node.failureChance > 0 && world.rng.chance(node.failureChance)) {
    failed = true;
    amount = 0;
  }
  if (amount > 0) {
    const bonus = node.resource === 'food' ? mech.harvestYieldBonus.food : 0;
    const extra = amount > 0 && bonus > 0 ? Math.min(1, Math.floor(amount * bonus)) : 0;
    amount = Math.min(amount + extra, node.stock);
    node.stock -= amount;
    agent.inventory[node.resource] += amount;
    agent.stats.harvested[node.resource] += amount;
    node.harvestHistory.push({ gameTime: world.gameTime, actorId: agent.id, amount });
  }
  emitEvent(world, failed ? 'harvest_failed' : 'harvest_completed', {
    actorId: agent.id,
    locationId: node.id,
    payload: { resource: node.resource, amount: failed ? 0 : amount, requested, nodeStockAfter: node.stock },
    salience: failed ? 6 : 4,
    sourceOperationId,
  });
  return { harvested: failed ? 0 : amount, failed };
}

// ---------------------------------------------------------------------------
// Inventory / containers
// ---------------------------------------------------------------------------

export function transfer(
  from: Inventory,
  to: Inventory,
  resource: 'water' | 'food',
  amount: number,
): number {
  const actual = Math.min(amount, from[resource]);
  from[resource] -= actual;
  to[resource] += actual;
  return actual;
}

export function totalResource(world: WorldState, resource: 'water' | 'food'): number {
  let total = 0;
  for (const n of Object.values(world.resources)) if (n.resource === resource) total += n.stock;
  for (const c of Object.values(world.containers)) total += c.inventory[resource];
  for (const a of Object.values(world.agents)) total += a.inventory[resource];
  return total;
}

// ---------------------------------------------------------------------------
// Knowledge & perception (6.4, MAP-004)
// ---------------------------------------------------------------------------

export function discoverLocation(
  world: WorldState,
  agentId: string,
  locationId: string,
  source: 'discovery' | 'share' | 'observation',
  confidence: number,
  sourceEventId?: string,
  value?: string,
) {
  const agent = world.agents[agentId];
  if (!agent || agent.knownLocations.includes(locationId)) return;
  const loc = world.map.locations.find((l) => l.id === locationId);
  agent.knownLocations.push(locationId);
  agent.knowledgeFacts.push({
    factId: `fact_${agentId}_${locationId}`,
    ownerId: agentId,
    factType: 'location',
    targetId: locationId,
    value: value ?? (loc ? `${loc.name}：${loc.description}` : '一个地点'),
    source,
    confidence,
    verified: source === 'discovery' || source === 'observation',
    gameTime: world.gameTime,
    sourceEventId,
  });
  const node = world.resources[locationId];
  if (node && !node.discoveredBy.includes(agentId)) node.discoveredBy.push(agentId);
  emitEvent(world, 'location_discovered', {
    actorId: agentId,
    locationId,
    payload: { source, confidence },
    salience: 6,
    observers: [agentId, ...resolveObservers(world, agent.position)],
  });
}

export function shareLocation(world: WorldState, fromId: string, toId: string, locationId: string, sourceEventId: string) {
  const from = world.agents[fromId];
  const to = world.agents[toId];
  if (!from?.isAlive || !to?.isAlive) return;
  if (!from.knownLocations.includes(locationId)) return; // can only share what you know
  const already = to.knownLocations.includes(locationId);
  discoverLocation(world, toId, locationId, 'share', 1, sourceEventId, `${from.name}告诉我的位置`);
  from.stats.locationsShared += 1;
  const loc = world.map.locations.find((l) => l.id === locationId);
  emitEvent(world, 'location_shared', {
    actorId: fromId,
    targetId: toId,
    locationId,
    payload: { alreadyKnown: already, locationName: loc?.name },
    salience: 7,
    observers: [fromId, toId, ...resolveObservers(world, from.position)],
    sourceOperationId: sourceEventId,
  });
  if (!already) {
    applyRelationshipDelta(world, toId, fromId, 'trust', 5, 'rule_share_location', '对方明确告知我地点信息', sourceEventId);
    applyRelationshipDelta(world, toId, fromId, 'affinity', 2, 'rule_share_location', '对方明确告知我地点信息', sourceEventId);
  }
}

export function locationName(world: WorldState, locationId: string): string {
  return world.map.locations.find((l) => l.id === locationId)?.name ?? locationId;
}

// ---------------------------------------------------------------------------
// Relationships (9.3/9.4, SOC-005)
// ---------------------------------------------------------------------------

export function applyRelationshipDelta(
  world: WorldState,
  fromId: string,
  toId: string,
  field: 'trust' | 'resentment' | 'dependency' | 'affinity',
  delta: number,
  ruleId: string,
  explanation: string,
  sourceEventId: string,
) {
  const rel = world.agents[fromId]?.relationships[toId];
  if (!rel) return;
  const prev = rel[field];
  if (field === 'trust') rel.trust = clamp(rel.trust + delta, -100, 100);
  else if (field === 'resentment') rel.resentment = clamp(rel.resentment + delta, 0, 100);
  else if (field === 'dependency') rel.dependency = clamp(rel.dependency + delta, 0, 100);
  else rel.affinity = clamp(rel.affinity + delta, -100, 100);
  rel.updatedAt = world.gameTime;
  const entry: RelationshipDelta = {
    sourceEventId,
    ruleId,
    field,
    delta,
    gameTime: world.gameTime,
    explanation,
  };
  rel.deltas.push(entry);
  if (rel.deltas.length > 60) rel.deltas.shift();
  world.relationshipHistory[fromId][toId].push({
    gameTime: world.gameTime,
    trust: rel.trust,
    resentment: rel.resentment,
    dependency: rel.dependency,
    affinity: rel.affinity,
  });
  void prev;
}

// ---------------------------------------------------------------------------
// Promises (SOC-004)
// ---------------------------------------------------------------------------

export function createPromise(
  world: WorldState,
  promiserId: string,
  recipientId: string,
  actionType: 'give' | 'share_location' | 'store',
  resource: 'water' | 'food' | undefined,
  amount: number | undefined,
  deadline: number,
  sourceEventId: string,
): string {
  const promiseId = `promise_${world.promiseLedger.length + 1}`;
  const record = {
    promiseId,
    promiserId,
    recipientId,
    actionType,
    resource,
    amount,
    deadline,
    createdAt: world.gameTime,
    status: 'pending' as const,
    sourceEventId,
  };
  world.promiseLedger.push(record);
  world.agents[promiserId].promises.push(record);
  return promiseId;
}

export function findMatchingPromise(
  world: WorldState,
  promiserId: string,
  recipientId: string,
  actionType: 'give' | 'share_location' | 'store',
  resource?: 'water' | 'food',
  amount?: number,
): (typeof world.promiseLedger)[number] | undefined {
  return world.promiseLedger.find(
    (p) =>
      p.status === 'pending' &&
      p.promiserId === promiserId &&
      p.recipientId === recipientId &&
      p.actionType === actionType &&
      (resource === undefined || p.resource === resource) &&
      (amount === undefined || (p.amount ?? 0) >= amount),
  );
}

export function adjudicatePromises(world: WorldState, now: number) {
  for (const p of world.promiseLedger) {
    if (p.status !== 'pending') continue;
    const promiser = world.agents[p.promiserId];
    const recipient = world.agents[p.recipientId];
    const due = now >= p.deadline;
    if (!due) continue;

    let status: 'fulfilled' | 'broken' | 'cancelled' | 'impossible';
    let reason = '';
    let salience = 6;
    if (!promiser?.isAlive) {
      status = 'impossible';
      reason = 'promiser_dead';
    } else if (!recipient?.isAlive) {
      status = 'cancelled';
      reason = 'recipient_dead';
    } else if (p.actionType === 'give') {
      const canGive = (promiser.inventory[p.resource ?? 'water'] ?? 0) >= (p.amount ?? 1);
      const resourceExists = totalResource(world, p.resource ?? 'water') >= (p.amount ?? 1);
      status = canGive ? 'broken' : resourceExists ? 'broken' : 'impossible';
      reason = canGive ? 'actor_kept_resource' : resourceExists ? 'actor_kept_resource' : 'resource_physically_unavailable';
      if (status === 'broken') salience = 9;
    } else if (p.actionType === 'share_location' && p.locationId) {
      status = promiser.knownLocations.includes(p.locationId) ? 'broken' : 'impossible';
      reason = status === 'broken' ? 'actor_kept_information' : 'actor_never_knew_location';
      if (status === 'broken') salience = 8;
    } else if (p.actionType === 'store') {
      const canStore = (promiser.inventory[p.resource ?? 'water'] ?? 0) >= (p.amount ?? 1);
      status = canStore ? 'broken' : 'impossible';
      reason = canStore ? 'actor_kept_resource' : 'actor_had_no_resource';
      if (status === 'broken') salience = 8;
    } else {
      status = 'broken';
      reason = 'unknown';
    }

    p.status = status;
    p.statusChangedAt = now;
    p.statusReason = reason;
    const evt = emitEvent(world, `promise_${status}`, {
      actorId: p.promiserId,
      targetId: p.recipientId,
      payload: {
        promiseId: p.promiseId,
        resource: p.resource,
        amount: p.amount,
        deadline: p.deadline,
        reason,
        wasPhysicallyPossible: status === 'broken',
      },
      salience,
      observers: [p.promiserId, p.recipientId, ...resolveObservers(world, world.agents[p.promiserId]?.position)],
    });
    p.adjudicationEventId = evt.eventId;

    if (status === 'broken') {
      world.agents[p.promiserId].stats.promisesBroken += 1;
      applyRelationshipDelta(world, p.recipientId, p.promiserId, 'trust', -15, 'rule_promise_broken', '承诺到期未履行', evt.eventId);
      applyRelationshipDelta(world, p.recipientId, p.promiserId, 'resentment', 10, 'rule_promise_broken', '承诺到期未履行', evt.eventId);
    }
  }
}

// ---------------------------------------------------------------------------
// Game Master (10.3, ACT-001..004)
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; validated: ValidatedAction; notes: string[] }
  | { ok: false; reason: string; detail: string };

export function gameMasterValidate(world: WorldState, intent: ActionIntent): ValidationResult {
  const agent = world.agents[intent.actorId];
  if (!agent || !agent.isAlive) return { ok: false, reason: 'dead_or_missing', detail: '角色不存在或已死亡' };
  if (agent.currentAction) return { ok: false, reason: 'not_idle', detail: '角色正在执行动作' };
  if (world.status !== 'running') return { ok: false, reason: 'world_not_running', detail: '世界未运行' };

  const notes: string[] = [];
  const a = intent.action;

  const known = (targetId: string) =>
    agent.knownLocations.includes(targetId) || world.agents[targetId] !== undefined;
  const near = (targetId: string, radius: number) => {
    const pos = targetPos(world, targetId);
    return pos ? tileDistance(agent.position, pos) <= radius : false;
  };

  switch (a.type) {
    case 'move': {
      if (!known(a.targetId)) return { ok: false, reason: 'unknown_target', detail: `未知地点 ${a.targetId}` };
      const pos = targetPos(world, a.targetId);
      if (!pos) return { ok: false, reason: 'unknown_target', detail: `无法定位 ${a.targetId}` };
      const path = findPath(world.map, roundPos(agent.position), pos);
      if (!path) return { ok: false, reason: 'unreachable', detail: `无法到达 ${a.targetId}` };
      const mech = compileMechanics(getProfile(agent.profileId));
      const load = agent.inventory.water + agent.inventory.food;
      const speed = mech.speedTilesPerMin * (1 / (1 + 0.04 * load)) * (agent.needs.stamina < 20 ? 0.6 : 1);
      const duration = pathDuration(world, path, speed);
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + duration, notes }, notes };
    }
    case 'explore': {
      if (!known(a.targetId)) return { ok: false, reason: 'unknown_target', detail: `未知区域 ${a.targetId}` };
      if (agent.needs.stamina < 10) return { ok: false, reason: 'exhausted', detail: '体力不足' };
      const mech = compileMechanics(getProfile(agent.profileId));
      const target = targetPos(world, a.targetId);
      const dist = target ? tileDistance(agent.position, target) : 0;
      // Physical travel time to reach the area, then explore.
      const travel = dist * 2;
      const duration = travel + 45 + 45 * mech.exploreTimeMultiplier * 0.4 + 15 * world.rng.next();
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + duration, notes }, notes };
    }
    case 'harvest': {
      const node = world.resources[a.targetId];
      if (!node) return { ok: false, reason: 'unknown_target', detail: `未知资源 ${a.targetId}` };
      if (!agent.knownLocations.includes(node.id)) return { ok: false, reason: 'unknown_target', detail: `未发现 ${node.id}` };
      if (!near(node.id, node.interactionRadius)) return { ok: false, reason: 'too_far', detail: '未到交互范围' };
      if (node.stock <= 0) return { ok: false, reason: 'resource_depleted', detail: `${node.id} 已采空` };
      if (a.amount <= 0) return { ok: false, reason: 'invalid_amount', detail: '采集数量必须为正' };
      if (agent.needs.stamina < 10) return { ok: false, reason: 'exhausted', detail: '体力不足' };
      const mech = compileMechanics(getProfile(agent.profileId));
      const timeMul = node.resource === 'water' ? mech.harvestTimeMultiplier.water : node.kind === 'tide_pool' ? mech.harvestTimeMultiplier.tide : mech.harvestTimeMultiplier.food;
      const duration = Math.max(20, Math.round(node.harvestDurationMinutes * timeMul * (a.amount > 1 ? 1 + 0.25 * (a.amount - 1) : 1)));
      const capacity = agentCapacity(agent);
      if (agent.inventory[node.resource] + a.amount > capacity) {
        notes.push(`容量限制：最多携带 ${capacity}，将按容量结算`);
      }
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + duration, notes }, notes };
    }
    case 'consume': {
      if (agent.inventory[a.resource] < a.amount) return { ok: false, reason: 'insufficient_inventory', detail: `库存不足（${a.resource}）` };
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + 5, notes }, notes };
    }
    case 'give': {
      const target = world.agents[a.targetId];
      if (!target?.isAlive) return { ok: false, reason: 'dead_or_missing', detail: '对方不存在或已死亡' };
      if (!near(a.targetId, 3)) return { ok: false, reason: 'too_far', detail: '需要靠近对方才能赠予' };
      if (agent.inventory[a.resource] < a.amount) return { ok: false, reason: 'insufficient_inventory', detail: '赠予库存不足' };
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + 5, notes }, notes };
    }
    case 'store':
    case 'take': {
      const container = world.containers[a.targetId];
      if (!container) return { ok: false, reason: 'unknown_target', detail: `未知容器 ${a.targetId}` };
      if (!near(a.targetId, 3)) return { ok: false, reason: 'too_far', detail: '需要靠近容器' };
      if (a.type === 'store' && agent.inventory[a.resource] < a.amount) return { ok: false, reason: 'insufficient_inventory', detail: '库存不足' };
      if (a.type === 'take' && container.inventory[a.resource] < a.amount) return { ok: false, reason: 'insufficient_inventory', detail: '容器库存不足' };
      if (a.type === 'take' && agent.inventory[a.resource] + a.amount > agentCapacity(agent)) return { ok: false, reason: 'over_capacity', detail: '超出携带上限' };
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + 5, notes }, notes };
    }
    case 'talk': {
      const target = world.agents[a.targetId];
      if (!target?.isAlive) return { ok: false, reason: 'dead_or_missing', detail: '对方不存在或已死亡' };
      if (!near(a.targetId, 3)) return { ok: false, reason: 'too_far', detail: '需要靠近对方才能交谈' };
      if (target.currentAction?.action.type === 'talk') return { ok: false, reason: 'busy', detail: '对方正在交谈' };
      const duration = 10 + 15 * world.rng.next();
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + duration, notes }, notes };
    }
    case 'rest': {
      const atCamp = a.targetId === 'crash_camp' && near('crash_camp', 4);
      if (a.targetId && !known(a.targetId)) return { ok: false, reason: 'unknown_target', detail: `未知地点 ${a.targetId}` };
      if (a.targetId && !near(a.targetId, 4)) return { ok: false, reason: 'too_far', detail: '需要先到休息地点' };
      const duration = a.durationMinutes ?? 60;
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + duration, notes: atCamp ? ['在营地休息，恢复更快'] : [] }, notes };
    }
    case 'loot_backpack': {
      const backpack = world.containers[a.targetId];
      if (!backpack || backpack.kind !== 'corpse_backpack') return { ok: false, reason: 'unknown_target', detail: '背包不存在' };
      if (!near(a.targetId, 2)) return { ok: false, reason: 'too_far', detail: '需要移动到背包旁' };
      return { ok: true, validated: { intent, startTime: world.gameTime, endTime: world.gameTime + 10, notes }, notes };
    }
    default:
      return { ok: false, reason: 'unknown_action', detail: '未知动作类型' };
  }
}

export function targetPos(world: WorldState, targetId: string): { x: number; y: number } | undefined {
  const agent = world.agents[targetId];
  if (agent) return agent.position;
  const loc = world.map.locations.find((l) => l.id === targetId);
  if (loc) return loc.position;
  const node = world.resources[targetId];
  if (node) return node.position;
  const container = world.containers[targetId];
  if (container) return container.position;
  return undefined;
}

export function agentCapacity(agent: AgentState): number {
  return compileMechanics(getProfile(agent.profileId)).carryCapacity;
}

function pathDuration(world: WorldState, path: { x: number; y: number }[], speed: number): number {
  let cost = 0;
  for (const p of path) cost += world.map.moveCost[p.y][p.x];
  return Math.max(1, Math.round((cost / speed) * 10) / 10);
}

// ---------------------------------------------------------------------------
// Action execution (8.1, ACT-002)
// ---------------------------------------------------------------------------

export function startAction(world: WorldState, agent: AgentState, intent: ActionIntent, validated: ValidatedAction, operationId: string): ActionInstance {
  const instance: ActionInstance = {
    instanceId: `act_${world.events.length + 1}`,
    actorId: agent.id,
    action: intent.action,
    publicIntent: intent.publicIntent,
    privateMotive: intent.privateMotive,
    startedAt: validated.startTime,
    endsAt: validated.endTime,
    status: 'running',
    sourceOperationId: operationId,
  };
  if (intent.action.type === 'move') {
    const pos = targetPos(world, intent.action.targetId)!;
    instance.path = findPath(world.map, roundPos(agent.position), pos) ?? [];
    // Recompute duration from path (already computed in validation; keep consistent).
    const mech = compileMechanics(getProfile(agent.profileId));
    const load = agent.inventory.water + agent.inventory.food;
    const speed = mech.speedTilesPerMin * (1 / (1 + 0.04 * load)) * (agent.needs.stamina < 20 ? 0.6 : 1);
    instance.endsAt = world.gameTime + pathDuration(world, instance.path, speed);
  }
  if (intent.action.type === 'harvest') {
    instance.reservation = { nodeId: intent.action.targetId, amount: intent.action.amount };
  }
  agent.currentAction = instance;
  return instance;
}

export function settleAction(world: WorldState, agent: AgentState): void {
  const inst = agent.currentAction;
  if (!inst) return;
  const a = inst.action;
  const opId = inst.sourceOperationId ?? `op_settle_${agent.id}_${world.gameTime}`;
  world.operationIds.add(opId);
  const profile = getProfile(agent.profileId);
  const mech = compileMechanics(profile);

  switch (a.type) {
    case 'move': {
      const target = targetPos(world, a.targetId);
      if (target) {
        agent.facing = { x: Math.sign(target.x - agent.position.x) || 1, y: Math.sign(target.y - agent.position.y) };
        agent.position = { ...target };
      }
      agent.needs.stamina = clamp(agent.needs.stamina - 6 * mech.staminaCostMultiplier, 0, 100);
      // Trigger discovery on arrival.
      checkDiscovery(world, agent);
      break;
    }
    case 'explore': {
      agent.needs.stamina = clamp(agent.needs.stamina - 14 * mech.staminaCostMultiplier, 0, 100);
      if (!agent.exploredZones.includes(a.targetId) && world.map.locations.find((l) => l.id === a.targetId)?.kind === 'zone') {
        agent.exploredZones.push(a.targetId);
      }
      // Reveal nearby undiscovered nodes/zones.
      let found = 0;
      for (const loc of world.map.locations) {
        if (agent.knownLocations.includes(loc.id)) continue;
        const dist = tileDistance(agent.position, loc.position);
        if (dist > 14) continue;
        const base = 0.66 - dist / 26;
        const bonus = (mech.discoveryBonus.general + (loc.id.includes('water') ? mech.discoveryBonus.water : loc.id.includes('coconut') || loc.id.includes('tide') ? mech.discoveryBonus.food : 0)) / 100;
        if (world.rng.chance(clamp(base + bonus, 0.05, 0.95))) {
          discoverLocation(world, agent.id, loc.id, 'discovery', 1);
          found++;
        }
      }
      // Always reveal the explored zone itself and anything within its radius.
      const targetLoc = world.map.locations.find((l) => l.id === a.targetId);
      if (targetLoc) {
        for (const other of world.map.locations) {
          if (agent.knownLocations.includes(other.id)) continue;
          if (tileDistance(targetLoc.position, other.position) <= (other.kind === 'node' ? 10 : 6)) {
            const base = other.kind === 'node' ? 0.9 : 0.8;
            const bonus = (mech.discoveryBonus.general + (other.id.includes('water') ? mech.discoveryBonus.water : mech.discoveryBonus.food)) / 100;
            if (world.rng.chance(clamp(base + bonus, 0.1, 0.97))) {
              discoverLocation(world, agent.id, other.id, 'discovery', 1);
              found++;
            }
          }
        }
      }
      if (found === 0) {
        emitEvent(world, 'explore_completed', { actorId: agent.id, locationId: a.targetId, payload: { found: 0 }, salience: 2 });
      }
      break;
    }
    case 'harvest': {
      const node = world.resources[a.targetId];
      if (node) {
        const cap = agentCapacity(agent);
        const maxByCapacity = Math.max(0, cap - agent.inventory[node.resource]);
        const amount = Math.min(a.amount, maxByCapacity);
        if (amount > 0 && node.stock > 0) {
          harvestFromNode(world, node, agent, amount, opId);
        } else {
          emitEvent(world, 'harvest_blocked', {
            actorId: agent.id,
            locationId: node.id,
            payload: { reason: node.stock <= 0 ? 'resource_depleted' : 'capacity_full', nodeStock: node.stock },
            salience: 5,
            sourceOperationId: opId,
          });
        }
      }
      agent.needs.stamina = clamp(agent.needs.stamina - 12 * mech.staminaCostMultiplier, 0, 100);
      break;
    }
    case 'consume': {
      const moved = transfer(agent.inventory, { water: 0, food: 0 }, a.resource, a.amount);
      agent.stats.consumed[a.resource] += moved;
      if (a.resource === 'water') agent.needs.water = clamp(agent.needs.water + 25 * moved, 0, 100);
      else agent.needs.food = clamp(agent.needs.food + 35 * moved, 0, 100);
      emitEvent(world, 'resource_consumed', {
        actorId: agent.id,
        payload: { resource: a.resource, amount: moved },
        salience: 3,
        observers: [agent.id, ...resolveObservers(world, agent.position)],
        sourceOperationId: opId,
      });
      break;
    }
    case 'give': {
      const target = world.agents[a.targetId];
      const moved = target ? transfer(agent.inventory, target.inventory, a.resource, a.amount) : 0;
      agent.stats.given[a.resource] += moved;
      if (target) target.stats.received[a.resource] += moved;
      const evt = emitEvent(world, 'resource_given', {
        actorId: agent.id,
        targetId: a.targetId,
        payload: { resource: a.resource, amount: moved },
        salience: 7,
        observers: [agent.id, a.targetId, ...resolveObservers(world, agent.position)],
        sourceOperationId: opId,
      });
      if (moved > 0 && target?.isAlive) {
        const giverScarce = agent.needs[a.resource === 'water' ? 'water' : 'food'] < 30;
        applyRelationshipDelta(world, a.targetId, agent.id, 'trust', giverScarce ? 13 : 8, giverScarce ? 'rule_give_scarce' : 'rule_give', '对方主动赠予我紧缺资源', evt.eventId);
        applyRelationshipDelta(world, a.targetId, agent.id, 'affinity', 3, 'rule_give', '对方主动赠予资源', evt.eventId);
        if (giverScarce) applyRelationshipDelta(world, a.targetId, agent.id, 'dependency', 4, 'rule_give_scarce', '对方在自己紧缺时仍给我资源', evt.eventId);
        // Fulfill matching promise.
        const promise = findMatchingPromise(world, agent.id, a.targetId, 'give', a.resource, moved);
        if (promise) {
          promise.status = 'fulfilled';
          promise.statusChangedAt = world.gameTime;
          promise.statusReason = 'give_delivered';
          const pe = emitEvent(world, 'promise_fulfilled', {
            actorId: agent.id,
            targetId: a.targetId,
            payload: { promiseId: promise.promiseId, resource: a.resource, amount: moved },
            salience: 8,
            observers: [agent.id, a.targetId, ...resolveObservers(world, agent.position)],
            sourceOperationId: opId,
          });
          promise.adjudicationEventId = pe.eventId;
          agent.stats.promisesFulfilled += 1;
          applyRelationshipDelta(world, a.targetId, agent.id, 'trust', 12, 'rule_promise_fulfilled', '对方兑现了承诺', pe.eventId);
          applyRelationshipDelta(world, a.targetId, agent.id, 'resentment', -5, 'rule_promise_fulfilled', '对方兑现了承诺', pe.eventId);
        }
      }
      break;
    }
    case 'store': {
      const container = world.containers[a.targetId];
      const moved = container ? transfer(agent.inventory, container.inventory, a.resource, a.amount) : 0;
      agent.stats.storedToPublic[a.resource] += moved;
      emitEvent(world, 'resource_stored', {
        actorId: agent.id,
        locationId: a.targetId,
        payload: { resource: a.resource, amount: moved },
        salience: 5,
        observers: [agent.id, ...resolveObservers(world, agent.position)],
        sourceOperationId: opId,
      });
      break;
    }
    case 'take': {
      const container = world.containers[a.targetId];
      const moved = container ? transfer(container.inventory, agent.inventory, a.resource, a.amount) : 0;
      agent.stats.takenFromPublic[a.resource] += moved;
      emitEvent(world, 'resource_taken', {
        actorId: agent.id,
        locationId: a.targetId,
        payload: { resource: a.resource, amount: moved },
        salience: 4,
        observers: [agent.id, ...resolveObservers(world, agent.position)],
        sourceOperationId: opId,
      });
      break;
    }
    case 'talk': {
      // Talk settlement handled by the conversation system (starts a conversation).
      break;
    }
    case 'rest': {
      agent.needs.stamina = clamp(agent.needs.stamina + (a.targetId === 'crash_camp' ? 38 : 22) * (inst.endsAt - inst.startedAt) / 60, 0, 100);
      break;
    }
    case 'loot_backpack': {
      const backpack = world.containers[a.targetId];
      if (backpack) {
        const w = transfer(backpack.inventory, agent.inventory, 'water', backpack.inventory.water);
        const f = transfer(backpack.inventory, agent.inventory, 'food', backpack.inventory.food);
        emitEvent(world, 'backpack_looted', {
          actorId: agent.id,
          locationId: a.targetId,
          payload: { water: w, food: f, ownerId: backpack.ownerId },
          salience: 7,
          observers: [agent.id, ...resolveObservers(world, agent.position)],
          sourceOperationId: opId,
        });
      }
      break;
    }
  }
  inst.status = 'completed';
  agent.currentAction = undefined;
  checkDiscovery(world, agent);
  agent.lastDecisionTime = -999; // allow immediate replan after action
}

export function interruptAction(world: WorldState, agent: AgentState, reason: string) {
  if (!agent.currentAction) return;
  agent.currentAction.status = 'interrupted';
  agent.currentAction = undefined;
  emitEvent(world, 'action_interrupted', {
    actorId: agent.id,
    payload: { reason },
    salience: 5,
    observers: [agent.id, ...resolveObservers(world, agent.position)],
  });
}

export function checkDiscovery(world: WorldState, agent: AgentState) {
  for (const zone of world.map.interactionZones) {
    if (zone.id === 'crash_camp' || agent.knownLocations.includes(zone.id)) continue;
    if (tileDistance(agent.position, zone.position) <= zone.radius) {
      discoverLocation(world, agent.id, zone.id, 'observation', 1, undefined, undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Conversations (9.1/9.2, SOC-001/002/003)
// ---------------------------------------------------------------------------

export function startConversation(world: WorldState, initiatorId: string, targetId: string, initialAct: SpeechAct | undefined, duration: number): Conversation {
  const conv: Conversation = {
    conversationId: `conv_${Object.keys(world.conversations).length + 1}`,
    participants: [initiatorId, targetId],
    startedAt: world.gameTime,
    endsAt: world.gameTime + duration,
    messages: [],
    status: 'active',
  };
  world.conversations[conv.conversationId] = conv;
  if (initialAct) {
    addMessage(world, conv.conversationId, initiatorId, initialAct);
  }
  return conv;
}

export function addMessage(world: WorldState, conversationId: string, speakerId: string, act: SpeechAct): void {
  const conv = world.conversations[conversationId];
  if (!conv) return;
  const msg = {
    messageId: `msg_${conv.messages.length + 1}`,
    conversationId,
    speakerId,
    speechAct: act,
    gameTime: world.gameTime,
  };
  conv.messages.push(msg);
  emitEvent(world, 'message_spoken', {
    actorId: speakerId,
    targetId: conv.participants.find((p) => p !== speakerId),
    locationId: undefined,
    payload: { conversationId, speechActType: act.type, text: act.text, resource: act.resource, amount: act.amount, locationId: act.locationId, promiseId: act.promiseId, deadline: act.deadline },
    salience: act.type === 'social_chat' ? 2 : 5,
    observers: [speakerId, conv.participants.find((p) => p !== speakerId)!, ...resolveObservers(world, world.agents[speakerId]?.position)],
  });
}

export function applySpeechActState(
  world: WorldState,
  speakerId: string,
  targetId: string | undefined,
  act: SpeechAct,
  sourceEventId: string,
): string[] {
  // Returns notes on state changes; only structured fields change state (SOC-003).
  const speaker = world.agents[speakerId];
  const notes: string[] = [];
  if (!speaker) return notes;
  switch (act.type) {
    case 'request_resource': {
      speaker.stats.requestsMade += 1;
      if (targetId) world.agents[targetId].stats.requestsReceived += 1;
      notes.push(`请求 ${act.amount} ${act.resource}`);
      break;
    }
    case 'reject_request': {
      speaker.stats.refusalsMade += 1;
      if (targetId) {
        const rel = world.agents[targetId]?.relationships[speakerId];
        if (rel && rel.trust > -90) {
          applyRelationshipDelta(world, targetId, speakerId, 'trust', -10, 'rule_refuse_crisis', '对方在我请求时拒绝', sourceEventId);
          applyRelationshipDelta(world, targetId, speakerId, 'resentment', 12, 'rule_refuse_crisis', '对方在我请求时拒绝', sourceEventId);
        }
      }
      notes.push('拒绝请求');
      break;
    }
    case 'accept_request': {
      // Acceptance alone does not move resources; creates a promise if initiator had requested.
      notes.push('接受请求');
      break;
    }
    case 'promise': {
      if (act.resource && targetId) {
        const deadline =
          (typeof act.deadline === 'string' ? parseGameTimeString(act.deadline) : undefined) ??
          world.gameTime + 8 * 60;
        const pid = createPromise(world, speakerId, targetId, 'give', act.resource, act.amount ?? 1, deadline, sourceEventId);
        notes.push(`承诺 ${act.amount} ${act.resource} 于 ${formatGameTime(deadline)}`);
        void pid;
      } else if (act.locationId && targetId) {
        const deadline =
          (typeof act.deadline === 'string' ? parseGameTimeString(act.deadline) : undefined) ??
          world.gameTime + 8 * 60;
        const pid = createPromise(world, speakerId, targetId, 'share_location', undefined, undefined, deadline, sourceEventId);
        const p = world.promiseLedger.find((x) => x.promiseId === pid);
        if (p) p.locationId = act.locationId;
        notes.push(`承诺分享地点 ${act.locationId}`);
      }
      break;
    }
    case 'cancel_promise': {
      const p = world.promiseLedger.find((x) => x.promiseId === act.promiseId && x.status === 'pending');
      if (p && p.promiserId === speakerId) {
        p.status = 'cancelled';
        p.statusChangedAt = world.gameTime;
        p.statusReason = 'promiser_cancelled_with_disclosure';
        notes.push('取消承诺');
      }
      break;
    }
    case 'share_location': {
      if (act.locationId && targetId) {
        shareLocation(world, speakerId, targetId, act.locationId, sourceEventId);
        notes.push(`分享地点 ${act.locationId}`);
      }
      break;
    }
    default:
      break;
  }
  return notes;
}

export function endConversation(world: WorldState, conversationId: string) {
  const conv = world.conversations[conversationId];
  if (!conv) return;
  conv.status = 'ended';
  emitEvent(world, 'conversation_ended', {
    locationId: undefined,
    payload: { conversationId, messageCount: conv.messages.length },
    salience: 2,
    observers: [...conv.participants, ...resolveObservers(world, world.agents[conv.participants[0]]?.position)],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function roundPos(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export function distToAgent(world: WorldState, a: string, b: string): number {
  const pa = world.agents[a]?.position;
  const pb = world.agents[b]?.position;
  return pa && pb ? tileDistance(pa, pb) : 999;
}

export function aliveAgents(world: WorldState): AgentState[] {
  return Object.values(world.agents).filter((a) => a.isAlive);
}

export function currentActionLabel(agent: AgentState): string {
  const a = agent.currentAction?.action;
  if (!a) return '空闲';
  switch (a.type) {
    case 'move': return `前往 ${a.targetId}`;
    case 'explore': return `探索 ${a.targetId}`;
    case 'harvest': return `采集 ${a.targetId}`;
    case 'consume': return `饮用/进食`;
    case 'give': return `赠予 ${a.targetId}`;
    case 'store': return `存入公共箱`;
    case 'take': return `从公共箱取用`;
    case 'talk': return `与 ${a.targetId} 交谈`;
    case 'rest': return '休息';
    case 'loot_backpack': return `拾取 ${a.targetId}`;
    default: return '未知';
  }
}

export function availableResourceStock(world: WorldState, resource: 'water' | 'food'): number {
  let total = 0;
  for (const n of Object.values(world.resources)) if (n.resource === resource) total += n.stock;
  for (const c of Object.values(world.containers)) total += c.inventory[resource];
  return total;
}

export type ActionOption = { action: Action; label: string; valueHint: string };

export function buildAvailableActions(world: WorldState, agent: AgentState): ActionOption[] {
  const opts: ActionOption[] = [];
  const knownLocs = agent.knownLocations;
  for (const locId of knownLocs) {
    const loc = world.map.locations.find((l) => l.id === locId);
    if (!loc) continue;
    const node = world.resources[locId];
    const dist = tileDistance(agent.position, loc.position);
    if (dist > 0) {
      opts.push({ action: { type: 'move', targetId: locId }, label: `前往${loc.name}`, valueHint: `距离约${dist}格` });
    }
    if (node && node.stock > 0 && dist <= node.interactionRadius + 1) {
      const cap = agentCapacity(agent);
      const free = Math.max(0, cap - agent.inventory[node.resource]);
      const amount = Math.min(free, node.stock, 2);
      if (amount > 0) {
        opts.push({ action: { type: 'harvest', targetId: node.id, amount }, label: `采集${node.resource === 'water' ? '淡水' : '食物'} x${amount}`, valueHint: `节点剩余${node.stock}` });
      }
    }
    if (locId === 'crash_camp' && dist <= 3) {
      const crate = world.containers.camp_crate;
      if (crate) {
        if (crate.inventory.water > 0) opts.push({ action: { type: 'take', targetId: 'camp_crate', resource: 'water', amount: 1 }, label: '从公共箱取水 x1', valueHint: `箱内${crate.inventory.water}` });
        if (crate.inventory.food > 0) opts.push({ action: { type: 'take', targetId: 'camp_crate', resource: 'food', amount: 1 }, label: '从公共箱取食 x1', valueHint: `箱内${crate.inventory.food}` });
        if (agent.inventory.water > 0) opts.push({ action: { type: 'store', targetId: 'camp_crate', resource: 'water', amount: 1 }, label: '存入公共箱水 x1', valueHint: `我持${agent.inventory.water}` });
        if (agent.inventory.food > 0) opts.push({ action: { type: 'store', targetId: 'camp_crate', resource: 'food', amount: 1 }, label: '存入公共箱食 x1', valueHint: `我持${agent.inventory.food}` });
      }
      opts.push({ action: { type: 'rest', targetId: 'crash_camp', durationMinutes: 60 }, label: '在营地休息 1 小时', valueHint: '恢复体力较快' });
      opts.push({ action: { type: 'explore', targetId: 'crash_camp' }, label: '在营地附近探索', valueHint: '寻找周边资源' });
    } else {
      const unexplored = loc.kind === 'zone' && !agent.exploredZones.includes(locId);
      opts.push({
        action: { type: 'explore', targetId: locId },
        label: unexplored ? `去${loc.name}探查（未探索区域，可能发现食物或水源）` : `探索${loc.name}周边`,
        valueHint: unexplored ? '很可能发现食物或水源' : '可能发现新地点',
      });
      if (dist <= 2) opts.push({ action: { type: 'rest', targetId: locId, durationMinutes: 60 }, label: `在${loc.name}休息`, valueHint: '恢复体力' });
    }
  }
  // Consume.
  if (agent.inventory.water > 0) opts.push({ action: { type: 'consume', resource: 'water', amount: 1 }, label: `喝水 x1（口渴度${Math.round(agent.needs.water)}）`, valueHint: `持有${agent.inventory.water}` });
  if (agent.inventory.food > 0) opts.push({ action: { type: 'consume', resource: 'food', amount: 1 }, label: `吃一份食物（饥饿度${Math.round(agent.needs.food)}）`, valueHint: `持有${agent.inventory.food}` });
  // Give to nearby alive agents.
  for (const other of Object.values(world.agents)) {
    if (other.id === agent.id || !other.isAlive) continue;
    const d = tileDistance(agent.position, other.position);
    if (d <= 3) {
      if (agent.inventory.water > 0) opts.push({ action: { type: 'give', targetId: other.id, resource: 'water', amount: 1 }, label: `给${other.name}水 x1`, valueHint: `距离${d}格` });
      if (agent.inventory.food > 0) opts.push({ action: { type: 'give', targetId: other.id, resource: 'food', amount: 1 }, label: `给${other.name}食 x1`, valueHint: `距离${d}格` });
      // Purposeful talk gate (SOC-001: 1-3 key conversations per island day):
      // only offer talk when there is a concrete reason (urgent need, pending
      // promise, or knowledge gap) and a cooldown has passed since last chat.
      const hasReason =
        agent.needs.water < 45 ||
        agent.needs.food < 40 ||
        other.needs.water < 45 ||
        other.needs.food < 40 ||
        world.promiseLedger.some(
          (p) =>
            p.status === 'pending' &&
            ((p.promiserId === agent.id && p.recipientId === other.id) || (p.promiserId === other.id && p.recipientId === agent.id)),
        ) ||
        other.knownLocations.some((l) => !agent.knownLocations.includes(l) && l !== 'crash_camp');
      const lastTalk = Math.max(
        0,
        ...Object.values(world.conversations)
          .filter((c) => c.participants.includes(agent.id) && c.participants.includes(other.id))
          .map((c) => c.endsAt ?? 0),
      );
      const cooldownOk = world.gameTime - lastTalk >= 6 * 60;
      if (hasReason && cooldownOk) {
        opts.push({ action: { type: 'talk', targetId: other.id }, label: `与${other.name}交谈`, valueHint: '请求/承诺/分享信息' });
      }
    } else if (d <= 12) {
      opts.push({ action: { type: 'move', targetId: other.id }, label: `去找${other.name}`, valueHint: `距离${d}格` });
    }
  }
  // Corpse backpacks.
  for (const c of Object.values(world.containers)) {
    if (c.kind !== 'corpse_backpack') continue;
    const d = tileDistance(agent.position, c.position);
    if (d <= 2) {
      opts.push({ action: { type: 'loot_backpack', targetId: c.id }, label: `拾取${c.ownerId ?? ''}的背包`, valueHint: `水${c.inventory.water} 食${c.inventory.food}` });
    } else if (d <= 14 && c.inventory.water + c.inventory.food > 0) {
      opts.push({ action: { type: 'move', targetId: c.id }, label: '前往死亡背包', valueHint: `距离${d}格` });
    }
  }
  if (opts.length === 0) {
    opts.push({ action: { type: 'rest', durationMinutes: 60 }, label: '原地休息', valueHint: '等待与恢复' });
  }
  return opts;
}

// Wasted resource accounting: nothing wasted in V0.1 unless stocks exceed capacity at day end
// (tracked by conservation ledger instead).
export function computeWaste(world: WorldState): Inventory {
  // Overproduction beyond capacity at final reconciliation.
  const waste: Inventory = { water: 0, food: 0 };
  for (const node of Object.values(world.resources)) {
    if (node.regenRule === 'restore_to_capacity_daily' && node.stock > node.capacity) {
      waste[node.resource] += node.stock - node.capacity;
      node.stock = node.capacity;
    }
  }
  return waste;
}
