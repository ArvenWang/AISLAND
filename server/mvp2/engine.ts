// MVP2 world engine: deterministic ticks, action state machine with visual
// phases, Game Master validation, movement on the runtime map, FOV/cognitive
// updates, needs/fire/mental progression, death and conservation.

import { RuntimeMap } from '../engine/map/runtimeMap';
import { findPath } from '../engine/map/pathGrid';
import { computeFov, fovRadiusAt, type LightLevel } from '../engine/perception/fov';
import { lightPhaseAt } from '../engine/perception/lighting';
import { updateConfidence, terrainDisorientation, landmarkBonus } from '../navigation/orientation';
import { executeExplorationStep } from '../navigation/exploration';
import { ActionInstance, ActionSpec, AgentState, Mvp2World, WorldEvent } from './types';
import { canPickup, dropItem, handoverItem, pickupItem, searchWreckage, takeUnattendedItem } from './items';
import { addFuel, createFire, tickFire } from './fire';
import { consume, startSleepAt, tickMental, tickNeeds, wakeUp } from './survival';
import { propagateSound } from './audio';

export type AgentBrain = {
  requestDecision(world: Mvp2World, agentId: string): Promise<{ plan: unknown; action: ActionSpec; provenance?: { llmRequestId: string } } | null>;
};

export const WORLD_END_TIME = 5 * 1440 + 1080; // day 5, 18:00

export function createWorldState(worldId: string, seed: number, map: RuntimeMap, agents: AgentState[]): Mvp2World {
  const agentsMap: Record<string, AgentState> = {};
  for (const a of agents) agentsMap[a.id] = a;
  return {
    worldId,
    seed,
    map,
    gameTime: 0,
    status: 'running',
    agents: agentsMap,
    groundItems: {},
    fires: {},
    resources: {},
    wrecks: {},
    events: [],
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
  return e;
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

function getNavSkill(agent: AgentState): number {
  return agent.profileId === 'agent_a' ? 78 : agent.profileId === 'agent_b' ? 45 : 62;
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
    case 'offer_item':
    case 'accept_handover': {
      if (spec.target.kind !== 'agent') return { ok: false, reason: 'bad_target' };
      const other = world.agents[spec.target.agentId];
      if (!other || !other.isAlive) return { ok: false, reason: 'no_agent' };
      if (d(other.x, other.y) > 3) return { ok: false, reason: 'too_far' };
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
    case 'talk':
    case 'observe':
      return { ok: true };
    default:
      return { ok: false, reason: 'unsupported' };
  }
}

export function startAction(world: Mvp2World, agent: AgentState, spec: ActionSpec, sourceRequestId?: string): ActionInstance | null {
  const check = gameMasterValidate(world, agent, spec);
  if (!check.ok) {
    const targetRef =
      spec.target.kind === 'item' ? spec.target.itemId :
      spec.target.kind === 'resource' ? spec.target.resourceId :
      spec.target.kind === 'agent' ? spec.target.agentId :
      spec.target.kind === 'wreck' ? spec.target.wreckId :
      spec.target.kind === 'fire' ? spec.target.fireId :
      spec.target.kind === 'cell' ? `${spec.target.x},${spec.target.y}` : undefined;
    // Auto-approach: interactive actions on out-of-range targets become a
    // move that chains into the intended action (PRD 16.3 approach->perform).
    if (check.reason === 'too_far' && (spec.approachDepth ?? 0) < 2) {
      const approachPath = planApproach(world, agent, spec);
      if (approachPath) {
        const move: ActionInstance = {
          actionId: `act_${world.actionSeq++}`,
          actorId: agent.id,
          type: 'move',
          target: { kind: 'cell', x: approachPath[approachPath.length - 1].x, y: approachPath[approachPath.length - 1].y },
          startedAt: world.gameTime,
          endsAt: world.gameTime + 10,
          phase: 'perform',
          progress: 0,
          waypointIndex: 0,
          visualActionId: `va_${world.actionSeq}_${agent.id}_approach`,
          path: approachPath,
          sourceRequestId,
          pending: { ...spec, approachDepth: (spec.approachDepth ?? 0) + 1 },
        };
        agent.currentAction = move;
        emitEvent(world, 'action_started', agent.id, undefined, { type: 'approach', targetType: spec.type, visualActionId: move.visualActionId }, [agent.id], 3, move.actionId, move.visualActionId);
        return move;
      }
    }
    emitEvent(world, 'action_rejected', agent.id, undefined, { type: spec.type, reason: check.reason, targetRef }, [agent.id], 4);
    return null;
  }
  if (spec.type === 'move' && spec.path && spec.path.length >= 2) {
    const action: ActionInstance = {
      actionId: `act_${world.actionSeq++}`,
      actorId: agent.id,
      type: 'move',
      target: spec.target,
      startedAt: world.gameTime,
      endsAt: world.gameTime + 10,
      phase: 'perform',
      progress: 0,
      waypointIndex: 0,
      visualActionId: `va_${world.actionSeq}_${agent.id}_move`,
      path: spec.path,
      sourceRequestId,
    };
    agent.currentAction = action;
    emitEvent(world, 'action_started', agent.id, undefined, { type: 'move', visualActionId: action.visualActionId }, [agent.id], 3, action.actionId, action.visualActionId);
    return action;
  }
  if (spec.type === 'move' && spec.target.kind === 'cell') {
    // Server-authoritative navigation: plan the path over known cells only.
    const path = findPath(world.map, { x: agent.x, y: agent.y }, { x: spec.target.x, y: spec.target.y }, {
      allowed: (x, y) => agent.cognitive.explored[y * world.map.width + x] === 1 || agent.cognitive.visible[y * world.map.width + x] === 1,
    });
    if (!path || path.length < 2) {
      emitEvent(world, 'action_rejected', agent.id, undefined, { type: 'move', reason: 'no_path', target: spec.target }, [agent.id], 4);
      return null;
    }
    const action: ActionInstance = {
      actionId: `act_${world.actionSeq++}`,
      actorId: agent.id,
      type: 'move',
      target: spec.target,
      startedAt: world.gameTime,
      endsAt: world.gameTime + 10,
      phase: 'perform',
      progress: 0,
      waypointIndex: 0,
      visualActionId: `va_${world.actionSeq}_${agent.id}_move`,
      path,
      sourceRequestId,
    };
    agent.currentAction = action;
    emitEvent(world, 'action_started', agent.id, undefined, { type: 'move', visualActionId: action.visualActionId }, [agent.id], 3, action.actionId, action.visualActionId);
    return action;
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
  };
  agent.currentAction = action;
  emitEvent(world, 'action_started', agent.id, undefined, { type: spec.type, visualActionId: action.visualActionId }, [agent.id], 3, action.actionId, action.visualActionId);
  return action;
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
  // Find a known, passable cell within `range` of the target, closest to the
  // agent, and path to it using only explored/visible cells.
  let best: { x: number; y: number; d: number } | null = null;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > range) continue;
      const x = tx + dx;
      const y = ty + dy;
      if (!world.map.inBounds(x, y)) continue;
      const i = y * world.map.width + x;
      if (world.map.isBlocked(x, y)) continue;
      if (!agent.cognitive.explored[i] && !agent.cognitive.visible[i]) continue;
      const d = Math.abs(x - agent.x) + Math.abs(y - agent.y);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  if (!best) return null;
  const path = findPath(world.map, { x: agent.x, y: agent.y }, { x: best.x, y: best.y }, {
    allowed: (x, y) => agent.cognitive.explored[y * world.map.width + x] === 1 || agent.cognitive.visible[y * world.map.width + x] === 1,
  });
  return path && path.length >= 2 ? path : null;
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
      return 12;
    case 'search_wreckage':
      return 40;
    case 'harvest_water':
    case 'harvest_food':
    case 'harvest_wood':
      return 25;
    case 'consume':
      return 10;
    case 'build_fire':
      return 30;
    case 'add_fuel':
      return 8;
    case 'sleep':
      return 240;
    case 'wake':
      return 2;
    case 'rest':
      return spec.durationMinutes ?? 90;
    case 'shout':
      return 6;
    case 'talk':
      return 12;
    case 'observe':
      return 8;
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
  let remaining = deltaMinutes;
  while (remaining > 0 && action.waypointIndex < action.path.length - 1) {
    const next = action.path[action.waypointIndex + 1];
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
  // Movement progress drives the client walk animation frames.
  action.progress = Math.min(1, action.waypointIndex / Math.max(1, action.path.length - 1));
  if (action.waypointIndex >= action.path.length - 1) {
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
        if (item) takeUnattendedItem(world, agent, item);
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
    case 'offer_item':
    case 'accept_handover': {
      if (action.target.kind === 'agent' && action.itemKind) {
        const other = world.agents[action.target.agentId];
        if (other && Math.abs(other.x - agent.x) + Math.abs(other.y - agent.y) <= 3) {
          const res = handoverItem(world, agent, other, action.itemKind, action.amount ?? 1);
          if (res.ok) {
            emitEvent(world, 'handover_completed', agent.id, other.id, { kind: action.itemKind, quantity: action.amount }, [agent.id, other.id], 7, action.actionId, action.visualActionId);
            other.relationships[agent.id] = other.relationships[agent.id] ?? { trust: 0, resentment: 0, dependency: 0, affinity: 0 };
            other.relationships[agent.id].trust = Math.min(100, other.relationships[agent.id].trust + 4);
          } else {
            emitEvent(world, 'handover_failed', agent.id, other.id, { reason: res.reason }, [agent.id, other.id], 4);
          }
        }
      }
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
          const qty = Math.min(r.stock, action.amount ?? 1);
          r.stock -= qty;
          const kind = action.type === 'harvest_water' ? 'water' : action.type === 'harvest_food' ? 'food' : 'wood';
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
      const targetId = action.target.kind === 'agent' ? action.target.agentId : undefined;
      const observers = Object.values(world.agents)
        .filter((a) => a.isAlive && a.id !== agent.id && Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) <= 6)
        .map((a) => a.id);
      emitEvent(world, 'message_spoken', agent.id, targetId, { text, targetId }, [agent.id, ...observers], 5, action.actionId, action.visualActionId);
      if (targetId && world.agents[targetId]) {
        world.agents[targetId].knowledge.claimsHeard.push(`message_${world.eventSeq - 1}`);
        addClaim(world, agent.id, targetId, text, world.gameTime);
      }
      break;
    }
    case 'observe':
      refreshVision(world, agent);
      break;
    default:
      break;
  }
  agent.currentAction = null;
}

export async function stepWorld(world: Mvp2World, deltaMinutes: number, brain: AgentBrain): Promise<void> {
  if (world.status !== 'running') return;
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
      if (a.progress >= 0.5 && !a.commitAt) a.commitAt = world.gameTime;
      if (world.gameTime >= a.endsAt) {
        a.phase = 'commit';
        commitAction(world, agent, a);
        // Action finished: allow an immediate re-decision on the next step
        // instead of waiting out the normal cooldown.
        agent.lastDecisionAt = world.gameTime - 1;
      }
    }
    const fire = fireLightAt(world, agent.x, agent.y);
    const sleeping = !!agent.sleep?.sleeping;
    const moving = agent.currentAction?.type === 'move';
    tickNeeds(agent, deltaMinutes, moving, sleeping, !!fire);
    const socialNearby = Object.values(world.agents).some((o) => o.id !== agent.id && o.isAlive && Math.abs(o.x - agent.x) + Math.abs(o.y - agent.y) <= 4);
    const corpseVisible = agent.cognitive.visible[agent.y * world.map.width + agent.x] === 0 ? false : Object.values(world.agents).some((o) => !o.isAlive && Math.abs(o.x - agent.x) + Math.abs(o.y - agent.y) <= 5);
    tickMental(agent, deltaMinutes, light === 'night' ? 'night' : light === 'dusk' ? 'dusk' : 'day', socialNearby, !!fire, corpseVisible);
    updateOrientation(world, agent, deltaMinutes, fire !== null);
  }

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
        emitEvent(world, 'agent_died', agent.id, undefined, {}, Object.values(world.agents).filter((a) => a.id !== agent.id).map((a) => a.id), 10);
      }
    }
  }

  // Decisions for idle, alive agents (light changes / action ends / needs).
  for (const agent of Object.values(world.agents)) {
    if (!agent.isAlive || agent.currentAction || agent.sleep?.sleeping) continue;
    const critical = agent.needs.water < 32 || agent.needs.food < 32 || agent.needs.health < 22;
    const cooldown = critical ? 20 : 45;
    if (light !== prevLight || world.gameTime - (agent.lastDecisionAt ?? 0) >= cooldown) {
      agent.lastDecisionAt = world.gameTime;
      agent.decisions++;
      const decision = await brain.requestDecision(world, agent.id);
      if (decision) {
        // Survival instinct (physiological, not a strategy hint): when severe
        // thirst is draining health and the agent knows a spring within a
        // short walk, override non-water actions to walk to that spring.
        if (agent.needs.water < 32) {
          if ((agent.inventory.water ?? 0) > 0 && decision.action.type !== 'consume') {
            // Carrying water: drink it before it is too late.
            decision.action = { type: 'consume', target: { kind: 'none' }, itemKind: 'water', amount: 1 };
          }
        }
        if (agent.needs.food < 32) {
          if ((agent.inventory.food ?? 0) > 0 && decision.action.type !== 'consume') {
            decision.action = { type: 'consume', target: { kind: 'none' }, itemKind: 'food', amount: 1 };
          }
        }
        if (agent.needs.water < 28 && decision.action.type !== 'harvest_water' && (agent.inventory.water ?? 0) <= 0) {
          const knownSpring = agent.knowledge.knownResources
            .map((id) => world.resources[id])
            .filter((r): r is NonNullable<typeof r> => !!r && r.kind === 'spring' && r.stock > 0)
            .sort((a, b) => Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) - (Math.abs(b.x - agent.x) + Math.abs(b.y - agent.y)))[0];
          if (knownSpring && Math.abs(knownSpring.x - agent.x) + Math.abs(knownSpring.y - agent.y) <= 60) {
            if (Math.abs(knownSpring.x - agent.x) + Math.abs(knownSpring.y - agent.y) <= 2) {
              // Already at the spring: harvest water directly.
              decision.action = { type: 'harvest_water', target: { kind: 'resource', resourceId: knownSpring.resourceId }, amount: 2 };
            } else {
              // Walk towards the spring via the exploration executor (known
              // cells only, with fallback), so blocked/unknown neighbours do
              // not produce a permanent no_path stall.
              const bearingDeg = Math.round((Math.atan2(knownSpring.x - agent.x, -(knownSpring.y - agent.y)) * 180) / Math.PI + 360) % 360;
              decision.action = { type: 'explore', target: { kind: 'direction', bearingDeg } };
              (decision.plan as { exploration?: { mode?: string; approximateBearing?: number } }).exploration = { mode: 'head_inland', approximateBearing: bearingDeg };
            }
          }
        }
        // Survival instinct for food: severe hunger + known berry bush.
        if (agent.needs.food < 28 && (agent.inventory.food ?? 0) <= 0 && decision.action.type !== 'harvest_food') {
          const knownBerry = agent.knowledge.knownResources
            .map((id) => world.resources[id])
            .filter((r): r is NonNullable<typeof r> => !!r && r.kind === 'berry_bush' && r.stock > 0)
            .sort((a, b) => Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) - (Math.abs(b.x - agent.x) + Math.abs(b.y - agent.y)))[0];
          if (knownBerry && Math.abs(knownBerry.x - agent.x) + Math.abs(knownBerry.y - agent.y) <= 80) {
            if (Math.abs(knownBerry.x - agent.x) + Math.abs(knownBerry.y - agent.y) <= 2) {
              decision.action = { type: 'harvest_food', target: { kind: 'resource', resourceId: knownBerry.resourceId }, amount: 2 };
            } else if (decision.action.type !== 'harvest_water' && !(decision.action.type === 'move' && decision.action.target.kind === 'cell' && Math.abs(decision.action.target.x - knownBerry.x) + Math.abs(decision.action.target.y - knownBerry.y) <= 2)) {
              const bearingDeg = Math.round((Math.atan2(knownBerry.x - agent.x, -(knownBerry.y - agent.y)) * 180) / Math.PI + 360) % 360;
              decision.action = { type: 'explore', target: { kind: 'direction', bearingDeg } };
              (decision.plan as { exploration?: { mode?: string; approximateBearing?: number } }).exploration = { mode: 'head_inland', approximateBearing: bearingDeg };
            }
          }
        }
        if (decision.provenance) world.llmLedger.push({ llmRequestId: decision.provenance.llmRequestId, agentId: agent.id, provider: 'dev', model: 'dev-driver', promptHash: '', responseHash: '', status: 'ok', tokenUsage: { input: 0, output: 0, cached: 0 }, latencyMs: 0, gameTime: world.gameTime });
        const started = startAction(world, agent, decision.action, decision.provenance?.llmRequestId);
        if (started && started.type === 'explore') {
          // Exploration executor: real movement on known cells.
          const plan = (decision.plan as { exploration?: { mode: 'follow_coast' | 'head_inland' | 'follow_slope' | 'follow_sound' | 'search_local' | 'return_to_landmark'; approximateBearing?: number; feature?: string } })?.exploration;
          const rng = makeRng(world.seed + world.actionSeq, agent.id);
          const seekingWater = agent.needs.water < 55 || /水|泉|河|溪/.test(agent.plan?.currentObjective ?? '');
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
          const step = executeExplorationStep(world.map, agent.cognitive, { x: agent.x, y: agent.y }, { mode: plan?.mode ?? 'head_inland', approximateBearing: bearing, objectiveText: agent.plan?.currentObjective ?? '探索', abortConditions: [], seekWater: seekingWater, avoid: agent.recentPath }, world.gameTime, rng);
          if (step && !step.aborted && step.path) {
            agent.currentAction = { ...started, type: 'move', path: step.path, phase: 'perform' };
            agent.recentPath = step.path.slice(0, 6);
          }
        }
      }
    }
  }

  // Relationship updates from social events (PRD 22.3: observable events only).
  for (const e of world.events) {
    if (e.gameTime < world.gameTime - 150) continue;
    if (e.type === 'handover_completed' && e.actorId && e.targetId) {
      bump(world, e.actorId, e.targetId, { trust: 4, affinity: 3 });
      bump(world, e.targetId, e.actorId, { trust: 2, affinity: 1 });
    } else if (e.type === 'handover_failed' && e.actorId && e.targetId) {
      bump(world, e.targetId, e.actorId, { trust: -4, resentment: 3 });
    } else if (e.type === 'item_taken_owned' && e.actorId && e.targetId) {
      const ownerId = e.payload.droppedBy as string | undefined;
      if (ownerId && ownerId !== e.actorId) {
        bump(world, e.actorId, ownerId, { resentment: 2 });
        bump(world, ownerId, e.actorId, { trust: -6, resentment: 6 });
      }
    } else if (e.type === 'message_spoken' && e.actorId && e.targetId) {
      bump(world, e.targetId, e.actorId, { affinity: 1 });
    }
  }

  const alive = Object.values(world.agents).filter((a) => a.isAlive).length;
  if (alive === 0) {
    world.status = 'ended';
    world.endedReason = 'all_dead';
  } else if (world.gameTime >= WORLD_END_TIME) {
    world.status = 'ended';
    world.endedReason = 'five_days';
  } else if (world.status === 'running') {
    // PRD 17.x/19.4: if an agent visibly repeats the same failing action,
    // pause the world with a clear notice instead of letting it stall to death.
    for (const agent of Object.values(world.agents)) {
      if (!agent.isAlive) continue;
      const rejects = world.events.filter((e) => e.actorId === agent.id && e.type === 'action_rejected' && e.gameTime >= world.gameTime - 90);
      if (rejects.length < 10) continue;
      const last = rejects[rejects.length - 1];
      const same = rejects.filter(
        (e) => String(e.payload?.targetRef ?? '') === String(last.payload?.targetRef ?? '') && String(e.payload?.type ?? '') === String(last.payload?.type ?? ''),
      ).length;
      if (same >= 10) {
        world.status = 'paused';
        emitEvent(world, 'world_paused', agent.id, undefined, { reason: 'stalled_agent', detail: `${agent.name} 反复尝试同一行动失败 ${same} 次，世界已暂停，请查看并调整。` }, [], 10);
        console.warn(`[mvp2] world ${world.worldId} paused: ${agent.name} stalled (${same} repeats)`);
        break;
      }
    }
  }
}

function bump(world: Mvp2World, fromId: string, toId: string, delta: Partial<{ trust: number; resentment: number; dependency: number; affinity: number }>) {
  const from = world.agents[fromId];
  const to = world.agents[toId];
  if (!from || !to || !from.isAlive || !to.isAlive) return;
  const rel = (from.relationships[toId] ??= { trust: 0, resentment: 0, dependency: 0, affinity: 0 });
  if (delta.trust) rel.trust = Math.max(0, Math.min(100, rel.trust + delta.trust));
  if (delta.resentment) rel.resentment = Math.max(0, Math.min(100, rel.resentment + delta.resentment));
  if (delta.dependency) rel.dependency = Math.max(0, Math.min(100, rel.dependency + delta.dependency));
  if (delta.affinity) rel.affinity = Math.max(0, Math.min(100, rel.affinity + delta.affinity));
}

function addClaim(world: Mvp2World, speakerId: string, listenerId: string, text: string, gameTime: number) {
  const w = world as unknown as { claims?: Array<{ claimId: string; speakerId: string; listenerId: string; text: string; gameTime: number; verifiedStatus: 'unverified' | 'supported' | 'contradicted'; listenerConfidence: number }> };
  const claims = (w.claims ??= []);
  if (claims.length >= 128) claims.shift();
  claims.push({
    claimId: `claim_${world.eventSeq++}`,
    speakerId,
    listenerId,
    text: text.slice(0, 80),
    gameTime,
    verifiedStatus: 'unverified',
    listenerConfidence: Math.min(1, 0.3 + (world.agents[listenerId]?.relationships[speakerId]?.trust ?? 0) / 200),
  });
  world.agents[listenerId].knowledge.claimsHeard.push(`claim_${world.eventSeq - 1}`);
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
