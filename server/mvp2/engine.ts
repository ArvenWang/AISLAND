// MVP2 world engine: deterministic ticks, action state machine with visual
// phases, Game Master validation, movement on the runtime map, FOV/cognitive
// updates, needs/fire/mental progression, death and conservation.

import { RuntimeMap } from '../engine/map/runtimeMap';
import { findPath } from '../engine/map/pathGrid';
import { computeFov, fovRadiusAt, type LightLevel } from '../engine/perception/fov';
import { lightPhaseAt } from '../engine/perception/lighting';
import { updateConfidence, terrainDisorientation, landmarkBonus } from '../navigation/orientation';
import { executeExplorationStep } from '../navigation/exploration';
import { ActionInstance, ActionSpec, AgentState, Mvp2World, WorldEvent, type WorldPresentationEvent } from './types';
import { canPickup, carryCapacity, dropItem, handoverItem, pickupItem, searchWreckage, takeUnattendedItem } from './items';
import { addFuel, createFire, tickFire } from './fire';
import { consume, startSleepAt, tickMental, tickNeeds, wakeUp } from './survival';
import { propagateSound } from './audio';
import { isWorldCellOccupied } from './collision';
import { compileMechanics, getProfile } from '../engine/profile';
import {
  adjudicateSocialFacts,
  adjudicateSpeechAct,
  advancePlanAfterAction,
  bindActionToPlan,
  createOfferFact,
  detectRepetition,
  observeWorldEvent,
  pendingOffer,
  recordSpeechFact,
  reduceSocialEvent,
  resolveOfferFact,
  runDailyReflections,
  utteranceSimilarity,
} from './evolution';

export type AgentBrain = {
  requestDecision(world: Mvp2World, agentId: string): Promise<{ plan: unknown; action: ActionSpec; provenance?: { llmRequestId: string } } | null>;
};

export const WORLD_START_TIME = 8 * 60; // Day 1, 08:00
export const WORLD_END_TIME = WORLD_START_TIME + 7 * 1440; // Day 8, 08:00

export function createWorldState(worldId: string, seed: number, map: RuntimeMap, agents: AgentState[]): Mvp2World {
  const agentsMap: Record<string, AgentState> = {};
  for (const a of agents) agentsMap[a.id] = a;
  return {
    worldId,
    seed,
    map,
    gameTime: WORLD_START_TIME,
    status: 'running',
    agents: agentsMap,
    groundItems: {},
    fires: {},
    resources: {},
    wrecks: {},
    conversations: {},
    events: [],
    presentationEvents: [],
    socialFacts: {},
    relationshipEvidence: [],
    repetitionIncidents: [],
    nearbyPairs: [],
    processedSocialEventIds: [],
    llmLedger: [],
    conservationLedger: [],
    actionSeq: 1,
    eventSeq: 1,
  };
}

export function emitEvent(world: Mvp2World, type: string, actorId: string | undefined, targetId: string | undefined, payload: Record<string, unknown>, observers: string[], salience: number, sourceActionId?: string, visualActionId?: string): WorldEvent {
  const e: WorldEvent = {
    eventId: `evt_${world.eventSeq++}`,
    worldId: world.worldId,
    gameTime: world.gameTime,
    type,
    actorId,
    targetId,
    locationId: actorId ? `${world.agents[actorId]?.x ?? 0},${world.agents[actorId]?.y ?? 0}` : undefined,
    payload,
    observers,
    salience,
    sourceActionId,
    visualActionId,
  };
  world.events.push(e);
  const kindByEvent: Record<string, WorldPresentationEvent['kind']> = {
    message_spoken: 'speech',
    shout: 'shout',
    item_picked_up: 'pickup',
    item_dropped: 'drop',
    handover_completed: 'handover',
    handover_refused: 'refuse',
    resource_harvested: 'harvest',
    consumed: 'consume',
    resource_discovered: 'discover',
    fire_lit: 'fire',
    fire_fueled: 'fire',
    sleep_started: 'sleep',
    woke_up: 'sleep',
    agent_died: 'death',
  };
  const kind = kindByEvent[type];
  if (kind) {
    world.presentationEvents.push({
      presentationId: `presentation_${e.eventId}`,
      sourceEventId: e.eventId,
      kind,
      actorId,
      targetId,
      text: typeof payload.text === 'string' ? payload.text : undefined,
      conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : undefined,
      gameTime: world.gameTime,
      importance: salience,
    });
  }
  integrateEvent(world, e);
  return e;
}

function integrateEvent(world: Mvp2World, event: WorldEvent): void {
  if (world.processedSocialEventIds.includes(event.eventId)) return;
  observeWorldEvent(world, event);
  detectRepetition(world, event);
  reduceSocialEvent(world, event);
  world.processedSocialEventIds.push(event.eventId);
}

function lightOf(world: Mvp2World): LightLevel {
  const p = lightPhaseAt(world.gameTime);
  return p === 'dawn' ? 'day' : p;
}

function fireLightAt(world: Mvp2World, x: number, y: number): { fireId: string; radius: number } | null {
  let best: { fireId: string; radius: number } | null = null;
  for (const f of Object.values(world.fires)) {
    if (f.state === 'out') continue;
    const d = Math.abs(f.x - x) + Math.abs(f.y - y);
    if (d <= f.lightRadius && (!best || f.lightRadius > best.radius)) best = { fireId: f.fireId, radius: f.lightRadius };
  }
  return best;
}

function refreshVision(world: Mvp2World, agent: AgentState) {
  const light = lightOf(world);
  const fire = fireLightAt(world, agent.x, agent.y);
  const opts = { light: fire ? ('fire' as LightLevel) : light, radiusBoost: fire?.radius };
  const radius = Math.max(fovRadiusAt(world.map, agent.x, agent.y, opts), fire ? 6 : 0);
  const visible = computeFov(world.map, agent.x, agent.y, radius);
  agent.cognitive.updateVision(visible, world.gameTime, { x: agent.x, y: agent.y });
  // Landmarks from visible terrain/entities.
  const terrain = world.map.terrainAt(agent.x, agent.y);
  if (terrain === 'wetSand' || terrain === 'drySand' || terrain === 'shallow') agent.cognitive.addLandmark('coast', agent.x, agent.y, world.gameTime);
  for (const f of Object.values(world.fires)) {
    if (f.state !== 'out' && visible[f.y * world.map.width + f.x]) agent.cognitive.addLandmark('fire', f.x, f.y, world.gameTime);
    if (visible[f.y * world.map.width + f.x] && !agent.knowledge.knownFires.includes(f.fireId)) agent.knowledge.knownFires.push(f.fireId);
  }
  for (const r of Object.values(world.resources)) {
    if (visible[r.y * world.map.width + r.x] && !agent.knowledge.knownResources.includes(r.resourceId)) {
      agent.knowledge.knownResources.push(r.resourceId);
      emitEvent(world, 'resource_discovered', agent.id, r.resourceId, { kind: r.kind }, [agent.id], 6);
    }
  }
  for (const it of Object.values(world.groundItems)) {
    if (visible[it.y * world.map.width + it.x] && !it.seenBy.includes(agent.id)) it.seenBy.push(agent.id);
  }
}

function updateOrientation(world: Mvp2World, agent: AgentState, deltaMinutes: number, reorient: boolean) {
  const l = lightOf(world);
  const light: 'day' | 'dusk' | 'night' = l === 'fire' ? 'night' : l;
  const fatigue = 1 - agent.needs.stamina / 100;
  const profile = getNavSkill(agent);
  const seenLandmarks = agent.cognitive.landmarks.filter((l) => agent.cognitive.visible[l.y * world.map.width + l.x]).map((l) => l.kind);
  updateConfidence({
    map: world.map,
    cognitive: agent.cognitive,
    x: agent.x,
    y: agent.y,
    light,
    fatigue,
    navigationSkill: profile,
    deltaMinutes,
    reorientSignal: reorient || seenLandmarks.length > 0,
    gameTime: world.gameTime,
  });
  void terrainDisorientation;
  void landmarkBonus;
}

export function updateAgentEncounters(world: Mvp2World): void {
  const alive = Object.values(world.agents).filter((agent) => agent.isAlive);
  const previous = new Set(world.nearbyPairs);
  const current: string[] = [];
  for (let left = 0; left < alive.length; left++) {
    for (let right = left + 1; right < alive.length; right++) {
      const a = alive[left];
      const b = alive[right];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 4) continue;
      const key = [a.id, b.id].sort().join('|');
      current.push(key);
      if (previous.has(key)) continue;
      const identitiesKnown = a.knowledge.introducedTo.includes(b.id) && b.knowledge.introducedTo.includes(a.id);
      emitEvent(world, 'encounter_started', a.id, b.id, {
        distance: Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
        exchangedInformation: identitiesKnown,
        identitiesKnown,
      }, [a.id, b.id], 8);
    }
  }
  world.nearbyPairs = current.sort();
}

export function isSelfIntroduction(text: string, name: string): boolean {
  const compact = text.replace(/[\s，。！？、,.!?：:；;“”"'（）()]/g, '');
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:我叫|我是|我的名字是|可以叫我|你可以叫我)${escapedName}`).test(compact);
}

function recentSimilarUtterance(world: Mvp2World, agentId: string, targetId: string, text: string): WorldEvent | undefined {
  const pair = [agentId, targetId].sort().join('|');
  return [...world.events].reverse().find((event) => event.type === 'message_spoken'
    && event.actorId
    && event.targetId
    && [event.actorId, event.targetId].sort().join('|') === pair
    && world.gameTime - event.gameTime <= 360
    && utteranceSimilarity(text, String(event.payload.text ?? '')) >= 0.88);
}

function getNavSkill(agent: AgentState): number {
  return getProfile(agent.profileId).skills.navigation;
}

export function gameMasterValidate(world: Mvp2World, agent: AgentState, spec: ActionSpec): { ok: boolean; reason?: string } {
  if (!agent.isAlive) return { ok: false, reason: 'dead' };
  if (agent.sleep?.sleeping && spec.type !== 'wake') return { ok: false, reason: 'sleeping' };
  const d = (x: number, y: number) => Math.abs(x - agent.x) + Math.abs(y - agent.y);
  switch (spec.type) {
    case 'move': {
      const t = spec.target;
      if (t.kind === 'cell') {
        if (t.x === agent.x && t.y === agent.y) return { ok: false, reason: 'already_here' };
        if (world.map.isBlocked(t.x, t.y)) return { ok: false, reason: 'blocked' };
        if (isWorldCellOccupied(world, t.x, t.y, agent.id)) return { ok: false, reason: 'occupied' };
        return { ok: true };
      }
      return { ok: false, reason: 'bad_target' };
    }
    case 'explore':
      return { ok: true };
    case 'pickup_item':
    case 'take_unattended_item': {
      const item = spec.target.kind === 'item' ? world.groundItems[spec.target.itemId] : undefined;
      if (!item) return { ok: false, reason: 'no_item' };
      if (d(item.x, item.y) > 2) return { ok: false, reason: 'too_far' };
      const check = canPickup(world, agent, item);
      return check;
    }
    case 'drop_item':
      return (agent.inventory[spec.itemKind ?? 'water'] ?? 0) >= (spec.amount ?? 1) ? { ok: true } : { ok: false, reason: 'not_enough' };
    case 'offer_item': {
      if (spec.target.kind !== 'agent') return { ok: false, reason: 'bad_target' };
      const other = world.agents[spec.target.agentId];
      if (!other || !other.isAlive) return { ok: false, reason: 'no_agent' };
      if (d(other.x, other.y) > 3) return { ok: false, reason: 'too_far' };
      if ((agent.inventory[spec.itemKind ?? 'water'] ?? 0) < (spec.amount ?? 1)) return { ok: false, reason: 'not_enough' };
      if (Object.values(world.socialFacts).some((fact) => fact.kind === 'offer' && fact.proposerId === agent.id && fact.recipientId === other.id && fact.status === 'pending')) return { ok: false, reason: 'offer_already_pending' };
      return { ok: true };
    }
    case 'accept_handover':
    case 'refuse_handover': {
      if (spec.target.kind !== 'offer') return { ok: false, reason: 'bad_target' };
      const offer = pendingOffer(world, spec.target.offerId);
      if (!offer || offer.recipientId !== agent.id) return { ok: false, reason: 'no_pending_offer' };
      const proposer = world.agents[offer.proposerId];
      if (!proposer?.isAlive) return { ok: false, reason: 'no_agent' };
      if (d(proposer.x, proposer.y) > 3) return { ok: false, reason: 'too_far' };
      return { ok: true };
    }
    case 'search_wreckage': {
      const w = spec.target.kind === 'wreck' ? world.wrecks[spec.target.wreckId] : undefined;
      if (!w) return { ok: false, reason: 'no_wreck' };
      if (d(w.x, w.y) > 2) return { ok: false, reason: 'too_far' };
      return { ok: true };
    }
    case 'harvest_water':
    case 'harvest_food':
    case 'harvest_wood': {
      const r = spec.target.kind === 'resource' ? world.resources[spec.target.resourceId] : undefined;
      if (!r) return { ok: false, reason: 'no_resource' };
      if (d(r.x, r.y) > 2) return { ok: false, reason: 'too_far' };
      if (!agent.knowledge.knownResources.includes(r.resourceId)) return { ok: false, reason: 'unknown' };
      if (r.stock < (spec.amount ?? 1)) return { ok: false, reason: 'empty' };
      return { ok: true };
    }
    case 'consume':
      return (agent.inventory[spec.itemKind ?? 'water'] ?? 0) >= (spec.amount ?? 1) ? { ok: true } : { ok: false, reason: 'not_enough' };
    case 'build_fire': {
      if (spec.target.kind !== 'cell') return { ok: false, reason: 'bad_target' };
      if (d(spec.target.x, spec.target.y) > 1) return { ok: false, reason: 'too_far' };
      if (spec.target.x === agent.x && spec.target.y === agent.y) return { ok: false, reason: 'occupied' };
      if (world.map.isBlocked(spec.target.x, spec.target.y) || isWorldCellOccupied(world, spec.target.x, spec.target.y, agent.id)) return { ok: false, reason: 'occupied' };
      if ((agent.inventory.tinder ?? 0) < 1 || (agent.inventory.wood ?? 0) < 3 || (agent.inventory.lighter ?? 0) < 1) {
        return { ok: false, reason: 'missing_materials' };
      }
      return { ok: true };
    }
    case 'add_fuel':
      return (agent.inventory.wood ?? 0) >= (spec.amount ?? 1) ? { ok: true } : { ok: false, reason: 'not_enough' };
    case 'sleep':
      return agent.sleep ? { ok: false, reason: 'already_sleeping' } : { ok: true };
    case 'wake':
      return agent.sleep ? { ok: true } : { ok: false, reason: 'not_sleeping' };
    case 'rest':
      return { ok: true };
    case 'shout':
    case 'observe':
      return { ok: true };
    case 'talk': {
      if (spec.target.kind !== 'agent') return { ok: false, reason: 'bad_target' };
      const other = world.agents[spec.target.agentId];
      if (!other || !other.isAlive) return { ok: false, reason: 'no_agent' };
      // A directed conversation is local world interaction. Keeping the same
      // range as the conversation-session separation rule prevents a remote
      // message from being created and immediately closed in the same tick.
      if (d(other.x, other.y) > 4) return { ok: false, reason: 'too_far' };
      // Do not let the initiator create another turn while the target still
      // owns the pending reply. This is conversation ordering, not a forced
      // response: either participant remains free to leave or do other work.
      if (other.pendingConversation?.fromId === agent.id) return { ok: false, reason: 'awaiting_response' };
      const text = spec.text?.trim() ?? '';
      if (text) {
        if (other.knowledge.introducedTo.includes(agent.id) && isSelfIntroduction(text, agent.name)) return { ok: false, reason: 'redundant_self_introduction' };
        if (recentSimilarUtterance(world, agent.id, other.id, text)) return { ok: false, reason: 'duplicate_utterance' };
      }
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'unsupported' };
  }
}

function beginMovement(world: Mvp2World, agent: AgentState, path: Array<{ x: number; y: number }>, sourceRequestId?: string, pending?: ActionSpec): ActionInstance {
  const purpose = pending ? 'approach' : 'move';
  const move: ActionInstance = {
    actionId: `act_${world.actionSeq++}`,
    actorId: agent.id,
    type: 'move',
    target: { kind: 'cell', x: path[path.length - 1].x, y: path[path.length - 1].y },
    startedAt: world.gameTime,
    endsAt: world.gameTime + movementDuration(world, agent, path),
    phase: 'perform',
    progress: 0,
    waypointIndex: 0,
    movementBudgetMinutes: 0,
    visualActionId: `va_${world.actionSeq}_${agent.id}_${purpose}`,
    path,
    sourceRequestId,
    pending,
  };
  bindActionToPlan(agent, move);
  agent.currentAction = move;
  emitEvent(world, 'action_started', agent.id, undefined, {
    type: purpose,
    ...(pending ? { targetType: pending.type } : {}),
    visualActionId: move.visualActionId,
    llmRequestId: sourceRequestId,
    provenanceKind: sourceRequestId ? 'llm' : 'system',
    planId: move.planId,
    planStepId: move.planStepId,
  }, [agent.id], 3, move.actionId, move.visualActionId);
  return move;
}

export function startAction(world: Mvp2World, agent: AgentState, spec: ActionSpec, sourceRequestId?: string): ActionInstance | null {
  const check = gameMasterValidate(world, agent, spec);
  if (!check.ok) {
    const targetRef =
      spec.target.kind === 'item' ? spec.target.itemId :
      spec.target.kind === 'resource' ? spec.target.resourceId :
      spec.target.kind === 'agent' ? spec.target.agentId :
      spec.target.kind === 'offer' ? spec.target.offerId :
      spec.target.kind === 'wreck' ? spec.target.wreckId :
      spec.target.kind === 'fire' ? spec.target.fireId :
      spec.target.kind === 'cell' ? `${spec.target.x},${spec.target.y}` : undefined;
    // Auto-approach: interactive actions on out-of-range targets become a
    // move that chains into the intended action (PRD 16.3 approach->perform).
    if (check.reason === 'too_far' && (spec.approachDepth ?? 0) < 2) {
      const approachPath = planApproach(world, agent, spec);
      if (approachPath) {
        return beginMovement(world, agent, approachPath, sourceRequestId, { ...spec, approachDepth: (spec.approachDepth ?? 0) + 1 });
      }
    }
    // A move_to intent may point at the visual center of a physical prop or
    // another survivor. Convert that intent into a reachable adjacent cell;
    // the authoritative position never enters the occupied footprint.
    if (spec.type === 'move' && spec.target.kind === 'cell' && ['blocked', 'occupied'].includes(check.reason ?? '')) {
      const nearPath = findKnownPathToRange(world, agent, spec.target.x, spec.target.y, check.reason === 'blocked' ? 4 : 1);
      if (nearPath) return beginMovement(world, agent, nearPath, sourceRequestId);
    }
    emitEvent(world, 'action_rejected', agent.id, undefined, { type: spec.type, reason: check.reason, targetRef }, [agent.id], 4);
    return null;
  }
  if (spec.type === 'move' && spec.path && spec.path.length >= 2) {
    if (spec.path.slice(1).some((cell) => world.map.isBlocked(cell.x, cell.y))) {
      emitEvent(world, 'action_rejected', agent.id, undefined, { type: 'move', reason: 'blocked_path' }, [agent.id], 4);
      return null;
    }
    return beginMovement(world, agent, spec.path, sourceRequestId);
  }
  if (spec.type === 'move' && spec.target.kind === 'cell') {
    // Server-authoritative navigation: plan the path over known cells only.
    const path = findPath(world.map, { x: agent.x, y: agent.y }, { x: spec.target.x, y: spec.target.y }, {
      allowed: (x, y) => (agent.cognitive.explored[y * world.map.width + x] === 1 || agent.cognitive.visible[y * world.map.width + x] === 1)
        && !isWorldCellOccupied(world, x, y, agent.id),
    });
    if (!path || path.length < 2) {
      emitEvent(world, 'action_rejected', agent.id, undefined, { type: 'move', reason: 'no_path', target: spec.target }, [agent.id], 4);
      return null;
    }
    return beginMovement(world, agent, path, sourceRequestId);
  }
  const minutes = durationFor(world, agent, spec);
  const action: ActionInstance = {
    actionId: `act_${world.actionSeq++}`,
    actorId: agent.id,
    type: spec.type,
    target: spec.target,
    amount: spec.amount,
    itemKind: spec.itemKind,
    startedAt: world.gameTime,
    endsAt: world.gameTime + minutes,
    phase: 'approach',
    progress: 0,
    waypointIndex: 0,
    visualActionId: `va_${world.actionSeq}_${agent.id}_${spec.type}`,
    sourceRequestId,
    text: spec.text,
    speechAct: spec.speechAct,
  };
  bindActionToPlan(agent, action);
  agent.currentAction = action;
  emitEvent(world, 'action_started', agent.id, undefined, { type: spec.type, visualActionId: action.visualActionId, llmRequestId: sourceRequestId, provenanceKind: sourceRequestId ? 'llm' : 'system', planId: action.planId, planStepId: action.planStepId }, [agent.id], 3, action.actionId, action.visualActionId);
  return action;
}

function movementEfficiency(world: Mvp2World, agent: AgentState): number {
  const mechanics = compileMechanics(getProfile(agent.profileId));
  const loadRatio = Math.min(1.5, agent.carryUsed / Math.max(1, carryCapacity(world, agent)));
  const loadPenalty = 1 - Math.min(0.35, loadRatio * 0.35);
  return Math.max(0.4, (mechanics.speedTilesPerMin / 1.6) * loadPenalty);
}

function movementDuration(world: Mvp2World, agent: AgentState, path: Array<{ x: number; y: number }>): number {
  return path.slice(1).reduce((minutes, cell) => minutes + world.map.moveCost(cell.x, cell.y), 0) / movementEfficiency(world, agent);
}

function planApproach(world: Mvp2World, agent: AgentState, spec: ActionSpec): Array<{ x: number; y: number }> | null {
  let tx: number;
  let ty: number;
  let range: number;
  switch (spec.type) {
    case 'pickup_item':
    case 'take_unattended_item': {
      const item = spec.target.kind === 'item' ? world.groundItems[spec.target.itemId] : undefined;
      if (!item) return null;
      tx = item.x;
      ty = item.y;
      range = 2;
      break;
    }
    case 'harvest_water':
    case 'harvest_food':
    case 'harvest_wood': {
      const r = spec.target.kind === 'resource' ? world.resources[spec.target.resourceId] : undefined;
      if (!r) return null;
      tx = r.x;
      ty = r.y;
      range = 2;
      break;
    }
    case 'offer_item':
    case 'talk': {
      const o = spec.target.kind === 'agent' ? world.agents[spec.target.agentId] : undefined;
      if (!o) return null;
      tx = o.x;
      ty = o.y;
      range = 3;
      break;
    }
    case 'accept_handover':
    case 'refuse_handover': {
      const offer = spec.target.kind === 'offer' ? pendingOffer(world, spec.target.offerId) : null;
      const proposer = offer ? world.agents[offer.proposerId] : undefined;
      if (!proposer) return null;
      tx = proposer.x;
      ty = proposer.y;
      range = 3;
      break;
    }
    case 'search_wreckage': {
      const w = spec.target.kind === 'wreck' ? world.wrecks[spec.target.wreckId] : undefined;
      if (!w) return null;
      tx = w.x;
      ty = w.y;
      range = 2;
      break;
    }
    case 'add_fuel': {
      const f = spec.target.kind === 'fire' ? world.fires[spec.target.fireId] : undefined;
      if (!f) return null;
      tx = f.x;
      ty = f.y;
      range = 3;
      break;
    }
    default:
      return null;
  }
  return findKnownPathToRange(world, agent, tx, ty, range);
}

function findKnownPathToRange(world: Mvp2World, agent: AgentState, tx: number, ty: number, range: number): Array<{ x: number; y: number }> | null {
  // Try every known, passable, unoccupied candidate. Sorting first by target
  // distance keeps interactions physically close; sorting second by agent
  // distance avoids a needlessly long detour when several cells are valid.
  const candidates: Array<{ x: number; y: number; targetDistance: number; agentDistance: number }> = [];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > range) continue;
      const x = tx + dx;
      const y = ty + dy;
      if (!world.map.inBounds(x, y)) continue;
      const i = y * world.map.width + x;
      if (world.map.isBlocked(x, y)) continue;
      if (isWorldCellOccupied(world, x, y, agent.id)) continue;
      if (!agent.cognitive.explored[i] && !agent.cognitive.visible[i]) continue;
      candidates.push({
        x,
        y,
        targetDistance: Math.abs(dx) + Math.abs(dy),
        agentDistance: Math.abs(x - agent.x) + Math.abs(y - agent.y),
      });
    }
  }
  candidates.sort((a, b) => a.targetDistance - b.targetDistance || a.agentDistance - b.agentDistance || a.y - b.y || a.x - b.x);
  for (const candidate of candidates) {
    const path = findPath(world.map, { x: agent.x, y: agent.y }, candidate, {
      allowed: (x, y) => (agent.cognitive.explored[y * world.map.width + x] === 1 || agent.cognitive.visible[y * world.map.width + x] === 1)
        && !isWorldCellOccupied(world, x, y, agent.id),
    });
    if (path && path.length >= 2) return path;
  }
  return null;
}

function durationFor(world: Mvp2World, agent: AgentState, spec: ActionSpec): number {
  switch (spec.type) {
    case 'move':
      return 0; // movement is path-driven, not duration-driven
    case 'explore':
      return 60;
    case 'pickup_item':
    case 'drop_item':
    case 'take_unattended_item':
      return 5;
    case 'offer_item':
    case 'accept_handover':
      return 8;
    case 'refuse_handover':
      return 6;
    case 'search_wreckage':
      return 12;
    case 'harvest_water':
    case 'harvest_food':
    case 'harvest_wood': {
      const kind = spec.type === 'harvest_water' ? 'water' : spec.type === 'harvest_food' ? 'food' : 'tide';
      return 8 * (compileMechanics(getProfile(agent.profileId)).harvestTimeMultiplier[kind] ?? 1);
    }
    case 'consume':
      return 8;
    case 'build_fire':
      return 16;
    case 'add_fuel':
      return 10;
    case 'sleep':
      return 240;
    case 'wake':
      return 5;
    case 'rest':
      return spec.durationMinutes ?? 90;
    case 'shout':
      return Math.max(8, Math.min(16, Math.ceil((spec.text?.length ?? 0) * 0.4 + 8)));
    case 'talk': {
      const visibleSeconds = Math.max(3.5, Math.min(7, 2.8 + (spec.text?.length ?? 0) * 0.065));
      return Math.ceil(visibleSeconds * 4);
    }
    case 'observe':
      return 6;
    default:
      return 15;
  }
}

function advanceMovement(world: Mvp2World, agent: AgentState, deltaMinutes: number) {
  const action = agent.currentAction;
  if (!action || action.type !== 'move') return;
  if (!action.path || action.path.length < 2) {
    agent.currentAction = null;
    emitEvent(world, 'action_rejected', agent.id, undefined, { type: 'move', reason: 'no_path' }, [agent.id], 4, action.actionId);
    return;
  }
  action.phase = 'perform';
  // Live simulation ticks are 5 island-minutes, while authored cells can
  // cost more than one tick. Carry unused minutes forward or those cells can
  // never be entered (each tick would repeatedly discard the same 5 minutes).
  let remaining = (action.movementBudgetMinutes ?? 0) + deltaMinutes * movementEfficiency(world, agent);
  while (remaining > 0 && action.waypointIndex < action.path.length - 1) {
    const next = action.path[action.waypointIndex + 1];
    if (isWorldCellOccupied(world, next.x, next.y, agent.id)) {
      const stoppedAdjacent = action.waypointIndex === action.path.length - 2;
      action.phase = stoppedAdjacent ? 'done' : 'interrupted';
      action.committed = stoppedAdjacent;
      action.commitAt = stoppedAdjacent ? world.gameTime : undefined;
      agent.currentAction = null;
      agent.lastDecisionAt = world.gameTime - 1;
      if (stoppedAdjacent) {
        const completedStep = advancePlanAfterAction(agent, action, world.gameTime);
        if (completedStep) emitEvent(world, 'plan_step_completed', agent.id, undefined, { planId: action.planId, stepId: completedStep.stepId, intent: completedStep.intent }, [agent.id], 6, action.actionId, action.visualActionId);
      }
      emitEvent(world, stoppedAdjacent ? 'move_completed' : 'action_rejected', agent.id, undefined, stoppedAdjacent
        ? { stoppedAdjacentToOccupied: true }
        : { type: 'move', reason: 'occupied', x: next.x, y: next.y }, [agent.id], stoppedAdjacent ? 2 : 4, action.actionId, action.visualActionId);
      if (stoppedAdjacent && action.pending) startAction(world, agent, action.pending, action.sourceRequestId);
      return;
    }
    const need = world.map.moveCost(next.x, next.y); // island-minutes per cell
    if (remaining >= need) {
      agent.facing = { x: Math.sign(next.x - agent.x) || 0, y: Math.sign(next.y - agent.y) || 0 };
      agent.x = next.x;
      agent.y = next.y;
      action.waypointIndex++;
      remaining -= need;
      refreshVision(world, agent);
    } else {
      break;
    }
  }
  action.movementBudgetMinutes = remaining;
  // Report partial progress toward the next authoritative cell so the client
  // can keep the walk cycle visibly alive between server coordinate changes.
  let partial = 0;
  if (action.waypointIndex < action.path.length - 1) {
    const next = action.path[action.waypointIndex + 1];
    const nextCost = world.map.moveCost(next.x, next.y);
    if (Number.isFinite(nextCost) && nextCost > 0) partial = Math.min(1, remaining / nextCost);
  }
  action.progress = Math.min(1, (action.waypointIndex + partial) / Math.max(1, action.path.length - 1));
  if (action.waypointIndex >= action.path.length - 1) {
    action.committed = true;
    action.commitAt = world.gameTime;
    const completedStep = advancePlanAfterAction(agent, action, world.gameTime);
    if (completedStep) emitEvent(world, 'plan_step_completed', agent.id, undefined, { planId: action.planId, stepId: completedStep.stepId, intent: completedStep.intent }, [agent.id], 6, action.actionId, action.visualActionId);
    agent.currentAction = null;
    emitEvent(world, 'move_completed', agent.id, undefined, {}, [agent.id], 2);
    // Path finished: allow an immediate re-decision on the next step instead
    // of waiting out the normal cooldown.
    agent.lastDecisionAt = world.gameTime - 1;
    if (action.pending) {
      // Chain into the intended interactive action now that we are adjacent.
      startAction(world, agent, action.pending, action.sourceRequestId);
    }
  }
}

function commitAction(world: Mvp2World, agent: AgentState, action: ActionInstance) {
  switch (action.type) {
    case 'pickup_item': {
      if (action.target.kind === 'item') {
        const item = world.groundItems[action.target.itemId];
        if (item) {
          const res = pickupItem(world, agent, item);
          if (res.ok) emitEvent(world, 'item_picked_up', agent.id, item.itemId, { kind: item.kind, quantity: item.quantity }, [agent.id, ...item.seenBy.filter((s) => s !== agent.id)], 5, action.actionId, action.visualActionId);
        }
      }
      break;
    }
    case 'take_unattended_item': {
      if (action.target.kind === 'item') {
        const item = world.groundItems[action.target.itemId];
        if (item) {
          const result = takeUnattendedItem(world, agent, item);
          if (result.ok && result.socialEvent) emitEvent(world, result.socialEvent.type, agent.id, result.socialEvent.targetId, result.socialEvent.payload, result.socialEvent.observers, result.socialEvent.salience, action.actionId, action.visualActionId);
        }
      }
      break;
    }
    case 'drop_item': {
      if (action.target.kind === 'cell' && action.itemKind) {
        const res = dropItem(world, agent, action.itemKind, action.amount ?? 1, action.target.x, action.target.y);
        if (res.ok) emitEvent(world, 'item_dropped', agent.id, res.itemId, { kind: action.itemKind, quantity: action.amount }, [agent.id], 4, action.actionId, action.visualActionId);
      }
      break;
    }
    case 'offer_item': {
      if (action.target.kind === 'agent' && action.itemKind) {
        const other = world.agents[action.target.agentId];
        if (other && Math.abs(other.x - agent.x) + Math.abs(other.y - agent.y) <= 3) {
          const offered = emitEvent(world, 'offer_created', agent.id, other.id, { kind: action.itemKind, quantity: action.amount ?? 1 }, [agent.id, other.id], 7, action.actionId, action.visualActionId);
          const fact = createOfferFact(world, agent.id, other.id, action.itemKind, action.amount ?? 1, offered.eventId);
          offered.payload.offerId = fact.factId;
        }
      }
      break;
    }
    case 'accept_handover': {
      const offer = action.target.kind === 'offer' ? pendingOffer(world, action.target.offerId) : null;
      if (!offer) break;
      const proposer = world.agents[offer.proposerId];
      if (!proposer) break;
      const res = handoverItem(world, proposer, agent, offer.itemKind, offer.amount);
      if (res.ok) {
        const completed = emitEvent(world, 'handover_completed', proposer.id, agent.id, { offerId: offer.factId, kind: offer.itemKind, quantity: offer.amount }, [proposer.id, agent.id], 8, action.actionId, action.visualActionId);
        resolveOfferFact(world, offer, 'accepted', completed.eventId);
      } else {
        const failed = emitEvent(world, 'handover_failed', proposer.id, agent.id, { offerId: offer.factId, reason: res.reason }, [proposer.id, agent.id], 5, action.actionId, action.visualActionId);
        resolveOfferFact(world, offer, 'failed', failed.eventId);
      }
      break;
    }
    case 'refuse_handover': {
      const offer = action.target.kind === 'offer' ? pendingOffer(world, action.target.offerId) : null;
      if (!offer) break;
      const refused = emitEvent(world, 'handover_refused', offer.proposerId, agent.id, { offerId: offer.factId, kind: offer.itemKind, quantity: offer.amount }, [offer.proposerId, agent.id], 7, action.actionId, action.visualActionId);
      resolveOfferFact(world, offer, 'refused', refused.eventId);
      break;
    }
    case 'search_wreckage': {
      if (action.target.kind === 'wreck') {
        const found = searchWreckage(world, agent, action.target.wreckId);
        emitEvent(world, 'wreck_searched', agent.id, action.target.wreckId, { found }, [agent.id], 6, action.actionId, action.visualActionId);
      }
      break;
    }
    case 'harvest_water':
    case 'harvest_food':
    case 'harvest_wood': {
      if (action.target.kind === 'resource') {
        const r = world.resources[action.target.resourceId];
        if (r && r.stock > 0 && Math.abs(r.x - agent.x) + Math.abs(r.y - agent.y) <= 2) {
          const kind = action.type === 'harvest_water' ? 'water' : action.type === 'harvest_food' ? 'food' : 'wood';
          const bonusKey = kind === 'wood' ? 'tide' : kind;
          const yieldMultiplier = 1 + (compileMechanics(getProfile(agent.profileId)).harvestYieldBonus[bonusKey] ?? 0);
          const qty = Math.min(r.stock, Math.round((action.amount ?? 1) * yieldMultiplier * 100) / 100);
          r.stock -= qty;
          agent.inventory[kind] = (agent.inventory[kind] ?? 0) + qty;
          agent.carryUsed = Object.values(agent.inventory).reduce((s, v) => s + (v ?? 0), 0);
          agent.stats.harvested[kind] = (agent.stats.harvested[kind] ?? 0) + qty;
          world.conservationLedger.push({ gameTime: world.gameTime, itemId: r.resourceId, kind, delta: -qty, note: 'harvest' });
          if (r.stock === 0) r.depletedAppearance = true;
          emitEvent(world, 'resource_harvested', agent.id, r.resourceId, { kind, quantity: qty, remaining: r.stock }, [agent.id], 6, action.actionId, action.visualActionId);
        }
      }
      break;
    }
    case 'consume': {
      if (action.itemKind) {
        const res = consume(world, agent, action.itemKind, action.amount ?? 1);
        if (res.ok) emitEvent(world, 'consumed', agent.id, undefined, { kind: action.itemKind, quantity: action.amount }, [agent.id], 4, action.actionId, action.visualActionId);
      }
      break;
    }
    case 'build_fire': {
      if (action.target.kind === 'cell') {
        const res = createFire(world, agent, action.target.x, action.target.y);
        if (res.ok) emitEvent(world, 'fire_lit', agent.id, res.fireId, { x: action.target.x, y: action.target.y }, [agent.id], 8, action.actionId, action.visualActionId);
      }
      break;
    }
    case 'add_fuel': {
      if (action.target.kind === 'fire') {
        const f = world.fires[action.target.fireId];
        if (f) {
          const res = addFuel(world, agent, f, action.amount ?? 1);
          if (res.ok) emitEvent(world, 'fire_fueled', agent.id, f.fireId, { wood: action.amount }, [agent.id], 5, action.actionId, action.visualActionId);
        }
      }
      break;
    }
    case 'sleep':
      startSleepAt(world, agent);
      emitEvent(world, 'sleep_started', agent.id, undefined, {}, [agent.id], 5, action.actionId, action.visualActionId);
      break;
    case 'wake':
      wakeUp(agent);
      emitEvent(world, 'woke_up', agent.id, undefined, {}, [agent.id], 3, action.actionId, action.visualActionId);
      break;
    case 'rest':
      agent.needs.stamina = Math.min(100, agent.needs.stamina + 12);
      break;
    case 'shout': {
      const text = action.text ?? '';
      const e = emitEvent(world, 'shout', agent.id, undefined, { text }, [agent.id], 6, action.actionId, action.visualActionId);
      const heard = propagateSound(world, agent.x, agent.y, text, e.eventId, agent.id);
      for (const l of Object.values(world.agents)) {
        if (!l.isAlive || l.id === agent.id) continue;
        const h = heard.find((hh) => hh.listenerId === l.id);
        if (h) {
          emitEvent(world, 'sound_heard', undefined, l.id, { ...h, listenerId: l.id }, [l.id], 5, action.actionId, action.visualActionId);
        }
      }
      break;
    }
    case 'talk': {
      const text = action.text ?? '';
      const declaredSpeechActType = ['utterance', 'claim', 'offer', 'request', 'promise', 'accept', 'refuse'].includes(action.speechAct ?? '')
        ? action.speechAct as 'utterance' | 'claim' | 'offer' | 'request' | 'promise' | 'accept' | 'refuse'
        : 'utterance';
      const targetId = action.target.kind === 'agent' ? action.target.agentId : undefined;
      const speechActType = adjudicateSpeechAct(world, agent.id, targetId, text, declaredSpeechActType);
      const observers = Object.values(world.agents)
        .filter((a) => a.isAlive && a.id !== agent.id && Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) <= 6)
        .map((a) => a.id);
      const session = targetId
        ? Object.values(world.conversations).find((conversation) => conversation.status === 'awaiting_response' && conversation.currentSpeakerId === agent.id && conversation.participantIds.includes(targetId))
        : undefined;
      const conversationId = session?.conversationId ?? `conversation_${world.eventSeq}`;
      const message = emitEvent(world, 'message_spoken', agent.id, targetId, {
        text,
        targetId,
        conversationId,
        speechActType,
        ...(speechActType !== declaredSpeechActType ? { declaredSpeechActType, speechActAdjudicated: true } : {}),
      }, [agent.id, ...observers], 5, action.actionId, action.visualActionId);
      const socialFact = recordSpeechFact(world, message, speechActType);
      if (socialFact?.kind === 'promise') emitEvent(world, 'promise_created', agent.id, targetId, { factId: socialFact.factId, action: socialFact.action, dueBy: socialFact.dueBy }, [agent.id, ...(targetId ? [targetId] : [])], 8, action.actionId, action.visualActionId);
      if (targetId && world.agents[targetId]) {
        const target = world.agents[targetId];
        if (isSelfIntroduction(text, agent.name) && !target.knowledge.introducedTo.includes(agent.id)) {
          target.knowledge.introducedTo.push(agent.id);
          emitEvent(world, 'identity_introduced', agent.id, target.id, {
            name: agent.name,
            sourceMessageEventId: message.eventId,
          }, [agent.id, target.id], 8, action.actionId, action.visualActionId);
        }
        target.knowledge.claimsHeard.push(message.eventId);
        if (session) {
          session.turns.push({ turnId: `${conversationId}_turn_${session.turns.length + 1}`, speakerId: agent.id, text, speechActType, gameTime: world.gameTime, eventId: message.eventId, llmRequestId: action.sourceRequestId });
          session.updatedAt = world.gameTime;
          agent.pendingConversation = undefined;
          if (session.turns.length >= 6) {
            session.status = 'completed';
            if (target.pendingConversation?.conversationId === conversationId) target.pendingConversation = undefined;
          } else {
            session.currentSpeakerId = targetId;
            session.status = 'awaiting_response';
            target.pendingConversation = { conversationId, fromId: agent.id, text, createdAt: world.gameTime };
          }
        } else {
          world.conversations[conversationId] = {
            conversationId,
            participantIds: [agent.id, targetId],
            status: 'awaiting_response',
            currentSpeakerId: targetId,
            turns: [{ turnId: `${conversationId}_turn_1`, speakerId: agent.id, text, speechActType, gameTime: world.gameTime, eventId: message.eventId, llmRequestId: action.sourceRequestId }],
            startedAt: world.gameTime,
            updatedAt: world.gameTime,
          };
          target.pendingConversation = { conversationId, fromId: agent.id, text, createdAt: world.gameTime };
        }
      }
      break;
    }
    case 'observe':
      refreshVision(world, agent);
      break;
    default:
      break;
  }
}

// Synchronous world step: time, movement, needs, fires, resources, sounds,
// death and relationship updates. No LLM calls, so real-time ticks never
// block on decisions (PRD 18.1 server-authoritative, smooth client motion).
export function stepWorldMovement(world: Mvp2World, deltaMinutes: number): string {
  if (world.status !== 'running') return lightPhaseAt(world.gameTime);
  const prevLight = lightPhaseAt(world.gameTime);
  world.gameTime += deltaMinutes;
  const light = lightOf(world);

  for (const agent of Object.values(world.agents)) {
    if (!agent.isAlive) continue;
    // Movement + action progress.
    if (agent.currentAction?.type === 'move') {
      advanceMovement(world, agent, deltaMinutes);
    } else if (agent.currentAction) {
      const a = agent.currentAction;
      a.progress = Math.min(1, (world.gameTime - a.startedAt) / Math.max(1, a.endsAt - a.startedAt));
      a.phase = a.progress < 0.2 ? 'prepare' : a.progress < 0.65 ? 'perform' : a.progress < 0.75 ? 'commit' : 'recover';
      if (a.progress >= 0.65 && !a.committed) {
        a.phase = 'commit';
        a.commitAt = world.gameTime;
        a.committed = true;
        commitAction(world, agent, a);
      }
      if (world.gameTime >= a.endsAt) {
        if (!a.committed) {
          a.phase = 'commit';
          a.commitAt = world.gameTime;
          a.committed = true;
          commitAction(world, agent, a);
        }
        a.phase = 'done';
        const completedStep = advancePlanAfterAction(agent, a, world.gameTime);
        if (completedStep) emitEvent(world, 'plan_step_completed', agent.id, undefined, { planId: a.planId, stepId: completedStep.stepId, intent: completedStep.intent }, [agent.id], 6, a.actionId, a.visualActionId);
        agent.currentAction = null;
        // Action finished: allow an immediate re-decision on the next step
        // instead of waiting out the normal cooldown.
        agent.lastDecisionAt = world.gameTime - 1;
      }
    }
    const fire = fireLightAt(world, agent.x, agent.y);
    const sleeping = !!agent.sleep?.sleeping;
    const moving = agent.currentAction?.type === 'move';
    tickNeeds(agent, deltaMinutes, moving, sleeping, !!fire);
    if (agent.sleep?.sleeping && !agent.currentAction && world.gameTime - agent.sleep.since >= 240) {
      // Sleep is a physical session, not an LLM decision. After four island
      // hours the body enters the visible wake action so sleepers cannot be
      // permanently excluded from all future decisions.
      startAction(world, agent, { type: 'wake', target: { kind: 'none' } });
    }
    const socialNearby = Object.values(world.agents).some((o) => o.id !== agent.id && o.isAlive && Math.abs(o.x - agent.x) + Math.abs(o.y - agent.y) <= 4);
    const corpseVisible = agent.cognitive.visible[agent.y * world.map.width + agent.x] === 0 ? false : Object.values(world.agents).some((o) => !o.isAlive && Math.abs(o.x - agent.x) + Math.abs(o.y - agent.y) <= 5);
    tickMental(agent, deltaMinutes, light === 'night' ? 'night' : light === 'dusk' ? 'dusk' : 'day', socialNearby, !!fire, corpseVisible);
    updateOrientation(world, agent, deltaMinutes, fire !== null);
  }

  // A proximity transition is an observed world fact, not a relationship or
  // behavior override. It gives both autonomous agents the same evidence that
  // they physically encountered someone, while leaving speech and cooperation
  // entirely to their later LLM decisions.
  updateAgentEncounters(world);

  // Fires consume fuel; resources regen.
  for (const f of Object.values(world.fires)) tickFire(world, f, deltaMinutes);
  for (const r of Object.values(world.resources)) {
    if (r.stock < r.capacity) {
      const before = r.stock;
      r.stock = Math.min(r.capacity, r.stock + (r.regenPerHour * deltaMinutes) / 60);
      if (r.stock > 0) r.depletedAppearance = false;
      const regenQty = r.stock - before;
      if (regenQty > 0) {
        const kind = r.kind === 'spring' ? 'water' : r.kind === 'berry_bush' ? 'food' : 'wood';
        world.conservationLedger.push({ gameTime: world.gameTime, itemId: r.resourceId, kind, delta: +regenQty, note: 'regen' });
      }
    }
  }

  // Conversations remain live for up to six turns, but an unanswered turn
  // expires naturally instead of trapping either participant forever.
  for (const conversation of Object.values(world.conversations)) {
    if (conversation.status !== 'awaiting_response') continue;
    const first = world.agents[conversation.participantIds[0]];
    const second = world.agents[conversation.participantIds[1]];
    const separated = !first?.isAlive || !second?.isAlive || !!first.sleep?.sleeping || !!second.sleep?.sleeping || Math.abs(first.x - second.x) + Math.abs(first.y - second.y) > 4;
    const timedOut = world.gameTime - conversation.updatedAt >= 120;
    if (!separated && !timedOut) continue;
    conversation.status = timedOut ? 'timed_out' : 'ended';
    conversation.updatedAt = world.gameTime;
    for (const participantId of conversation.participantIds) {
      const participant = world.agents[participantId];
      if (participant?.pendingConversation?.conversationId === conversation.conversationId) participant.pendingConversation = undefined;
    }
  }

  // Ambient spring sounds: every ~2 island-hours each flowing spring emits
  // a water sound so nearby survivors can hear a direction to fresh water
  // (PRD 9.2 sound propagation; no map/vision help).
  if (world.gameTime % 120 < deltaMinutes) {
    for (const r of Object.values(world.resources)) {
      if (r.kind !== 'spring' || r.stock <= 0) continue;
      const sourceEventId = `spring_snd_${r.resourceId}_${world.gameTime}`;
      const heard = propagateSound(world, r.x, r.y, '流水声（泉水）', sourceEventId, 'nature');
      for (const h of heard) {
        emitEvent(world, 'sound_heard', undefined, h.listenerId, { ...h, listenerId: h.listenerId }, [h.listenerId], 4);
      }
    }
  }

  // Death: drop inventory as ground items.
  for (const agent of Object.values(world.agents)) {
    if (!agent.isAlive) {
      const alreadyNotified = world.events.some((e) => e.type === 'agent_died' && e.actorId === agent.id);
      if (!alreadyNotified) {
        for (const [kind, qty] of Object.entries(agent.inventory)) {
          if ((qty ?? 0) > 0) {
            spawnDeathItems(world, agent, kind as never, qty ?? 0);
          }
        }
        agent.inventory = {};
        agent.carryUsed = 0;
        agent.currentAction = null;
        const cause = agent.needs.water <= 0 ? 'dehydration' : agent.needs.food <= 0 ? 'starvation' : agent.needs.sleepNeed >= 100 ? 'exhaustion' : 'health_collapse';
        emitEvent(world, 'agent_died', agent.id, undefined, { cause, needs: { ...agent.needs } }, Object.values(world.agents).filter((a) => a.id !== agent.id).map((a) => a.id), 10);
      }
    }
  }

  for (const result of adjudicateSocialFacts(world)) {
    emitEvent(world, result.type, result.actorId, result.targetId, { factId: result.factId }, [result.actorId, result.targetId], 8);
  }
  runDailyReflections(world);

  const alive = Object.values(world.agents).filter((a) => a.isAlive).length;
  if (alive === 0) {
    world.status = 'ended';
    world.endedReason = 'all_dead';
  } else if (world.gameTime >= WORLD_END_TIME) {
    world.status = 'ended';
    world.endedReason = 'seven_days';
  }
  return prevLight;
}

// Decision phase: idle agents whose cooldown elapsed ask the real LLM for the
// next action. Kept separate from stepWorldMovement so live ticks never wait
// on network latency.
export async function decideAgents(world: Mvp2World, brain: AgentBrain, prevLight: string): Promise<void> {
  if (world.status !== 'running') return;
  const light = lightOf(world);
  // Decisions for idle, alive agents (light changes / action ends / needs).
  for (const agent of Object.values(world.agents)) {
    if (!agent.isAlive || agent.currentAction || agent.sleep?.sleeping) continue;
    const cooldown = 45;
    const hasPendingConversation = !!agent.pendingConversation;
    if (hasPendingConversation || light !== prevLight || world.gameTime - (agent.lastDecisionAt ?? 0) >= cooldown) {
      agent.lastDecisionAt = world.gameTime;
      agent.decisions++;
      const previousPlanId = agent.plan?.planId;
      const previousGoal = agent.plan?.goal;
      const decision = await brain.requestDecision(world, agent.id);
      if (decision) {
        if (agent.plan && agent.plan.planId !== previousPlanId) {
          emitEvent(world, 'plan_replanned', agent.id, undefined, {
            oldPlanId: previousPlanId,
            oldGoal: previousGoal,
            newPlanId: agent.plan.planId,
            newGoal: agent.plan.goal,
            reasonForPlan: agent.plan.reasonForPlan,
            evidenceEventIds: agent.plan.evidenceEventIds,
            llmRequestId: decision.provenance?.llmRequestId,
          }, [agent.id], 7);
        }
        const pending = agent.pendingConversation;
        const isConversationReply = pending && decision.action.type === 'talk' && decision.action.target.kind === 'agent' && decision.action.target.agentId === pending.fromId;
        if (pending && !isConversationReply) {
          const conversation = world.conversations[pending.conversationId];
          if (conversation && conversation.status === 'awaiting_response') {
            conversation.status = 'ended';
            conversation.updatedAt = world.gameTime;
          }
          agent.pendingConversation = undefined;
        }
        const started = startAction(world, agent, decision.action, decision.provenance?.llmRequestId);
        if (started && started.type === 'explore') {
          // Exploration executor: real movement on known cells.
          const plan = (decision.plan as { exploration?: { mode: 'follow_coast' | 'head_inland' | 'follow_slope' | 'follow_sound' | 'search_local' | 'return_to_landmark'; approximateBearing?: number; feature?: string } })?.exploration;
          const rng = makeRng(world.seed + world.actionSeq, agent.id);
          const activeIntent = agent.plan?.steps[agent.plan.currentStepIndex]?.intent ?? agent.plan?.goal ?? '';
          const seekingWater = /水|泉|河|溪/.test(activeIntent) || plan?.mode === 'follow_sound';
          let bearing = plan?.approximateBearing;
          if (bearing === undefined && seekingWater) {
            // Perception-driven default: if the agent is hunting for water and
            // recently heard a spring, head towards that sound (factual sense,
            // not a strategy hint).
            const snd = [...world.events]
              .reverse()
              .find((e) => e.type === 'sound_heard' && e.observers.includes(agent.id) && String(e.payload?.text ?? '').includes('泉水'));
            if (snd) {
              const label = String(snd.payload?.bearing ?? '');
              const bearingMap: Record<string, number> = { '北': 0, '东北': 45, '东': 90, '东南': 135, '南': 180, '西南': 225, '西': 270, '西北': 315 };
              bearing = bearingMap[label];
            }
          }
          const step = executeExplorationStep(world.map, agent.cognitive, { x: agent.x, y: agent.y }, { mode: plan?.mode ?? 'head_inland', approximateBearing: bearing, objectiveText: activeIntent || '探索', abortConditions: [], seekWater: seekingWater, avoid: agent.recentPath }, world.gameTime, rng);
          if (step && !step.aborted && step.path) {
            agent.currentAction = {
              ...started,
              type: 'move',
              path: step.path,
              phase: 'perform',
              endsAt: world.gameTime + movementDuration(world, agent, step.path),
              waypointIndex: 0,
              movementBudgetMinutes: 0,
            };
            agent.recentPath = step.path.slice(0, 6);
          }
        }
      }
    }
  }
}

export async function stepWorld(world: Mvp2World, deltaMinutes: number, brain: AgentBrain): Promise<void> {
  const prevLight = stepWorldMovement(world, deltaMinutes);
  await decideAgents(world, brain, prevLight);
}

function spawnDeathItems(world: Mvp2World, agent: AgentState, kind: 'water' | 'food' | 'wood' | 'tinder' | 'lighter', qty: number) {
  world.groundItems[`item_${world.actionSeq++}`] = {
    itemId: `item_${world.actionSeq - 1}`,
    kind,
    quantity: qty,
    x: agent.x,
    y: agent.y,
    source: 'death',
    droppedBy: agent.id,
    seenBy: [],
    claimRecords: [],
    createdAt: world.gameTime,
  };
  world.conservationLedger.push({ gameTime: world.gameTime, itemId: `item_${world.actionSeq - 1}`, kind, delta: 0, note: `death_drop:${agent.id}` });
}

function makeRng(seed: number, salt: string): () => number {
  let a = (seed ^ hashSalt(salt)) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSalt(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { findPath };
