// Ground item operations: pickup/drop/handover/unattended-take, wreckage
// search, item merging, and a conservation ledger (PRD 10, 21.3).

import { Mvp2World, GroundItem, ItemKind, AgentState } from './types';

export function inventoryCount(agent: AgentState, kind: ItemKind): number {
  return agent.inventory[kind] ?? 0;
}

export function carryUsed(agent: AgentState): number {
  let total = 0;
  for (const v of Object.values(agent.inventory)) total += v ?? 0;
  return total;
}

export function carryCapacity(world: Mvp2World, agent: AgentState): number {
  const base = 10;
  const backpackBonus = inventoryCount(agent, 'backpack') > 0 ? 6 : 0;
  return base + backpackBonus;
}

export function spawnGroundItem(world: Mvp2World, kind: ItemKind, quantity: number, x: number, y: number, source: GroundItem['source'], droppedBy?: string, note = ''): string {
  const itemId = `item_${world.actionSeq++}`;
  world.groundItems[itemId] = {
    itemId,
    kind,
    quantity,
    x,
    y,
    source,
    droppedBy,
    seenBy: [],
    claimRecords: [],
    createdAt: world.gameTime,
  };
  world.conservationLedger.push({ gameTime: world.gameTime, itemId, kind, delta: quantity, note: `spawn:${source} ${note}` });
  return itemId;
}

export function mergeOrCreateGroundItem(world: Mvp2World, kind: ItemKind, quantity: number, x: number, y: number, source: GroundItem['source'], droppedBy?: string): string {
  const existing = Object.values(world.groundItems).find((g) => g.kind === kind && g.x === x && g.y === y && g.source !== 'death');
  if (existing) {
    existing.quantity += quantity;
    world.conservationLedger.push({ gameTime: world.gameTime, itemId: existing.itemId, kind, delta: 0, note: 'merge (held->ground)' });
    return existing.itemId;
  }
  return spawnGroundItem(world, kind, quantity, x, y, source, droppedBy);
}

export function canPickup(world: Mvp2World, agent: AgentState, item: GroundItem): { ok: boolean; reason?: string } {
  if (!agent.isAlive) return { ok: false, reason: 'dead' };
  const d = Math.abs(item.x - agent.x) + Math.abs(item.y - agent.y);
  if (d > 2) return { ok: false, reason: 'too_far' };
  if (carryUsed(agent) + item.quantity > carryCapacity(world, agent)) return { ok: false, reason: 'capacity' };
  return { ok: true };
}

export function pickupItem(world: Mvp2World, agent: AgentState, item: GroundItem): { ok: boolean; reason?: string; itemId?: string } {
  const check = canPickup(world, agent, item);
  if (!check.ok) return check;
  agent.inventory[item.kind] = (agent.inventory[item.kind] ?? 0) + item.quantity;
  agent.carryUsed = carryUsed(agent);
  if (!agent.knowledge.knownItems.includes(item.itemId)) agent.knowledge.knownItems.push(item.itemId);
  world.conservationLedger.push({ gameTime: world.gameTime, itemId: item.itemId, kind: item.kind, delta: 0, note: `pickup by ${agent.id} (ground->held)` });
  delete world.groundItems[item.itemId];
  return { ok: true, itemId: item.itemId };
}

export function dropItem(world: Mvp2World, agent: AgentState, kind: ItemKind, quantity: number, x: number, y: number): { ok: boolean; reason?: string; itemId?: string } {
  if (!agent.isAlive) return { ok: false, reason: 'dead' };
  const have = inventoryCount(agent, kind);
  if (have < quantity) return { ok: false, reason: 'not_enough' };
  agent.inventory[kind] = have - quantity;
  if (agent.inventory[kind] === 0) delete agent.inventory[kind];
  agent.carryUsed = carryUsed(agent);
  const itemId = mergeOrCreateGroundItem(world, kind, quantity, x, y, 'dropped', agent.id);
  return { ok: true, itemId };
}

export function handoverItem(world: Mvp2World, giver: AgentState, receiver: AgentState, kind: ItemKind, quantity: number): { ok: boolean; reason?: string } {
  if (!giver.isAlive || !receiver.isAlive) return { ok: false, reason: 'dead' };
  if (inventoryCount(giver, kind) < quantity) return { ok: false, reason: 'not_enough' };
  if (carryUsed(receiver) + quantity > carryCapacity(world, receiver)) return { ok: false, reason: 'receiver_capacity' };
  giver.inventory[kind] = inventoryCount(giver, kind) - quantity;
  if (giver.inventory[kind] === 0) delete giver.inventory[kind];
  giver.carryUsed = carryUsed(giver);
  receiver.inventory[kind] = inventoryCount(receiver, kind) + quantity;
  receiver.carryUsed = carryUsed(receiver);
  world.conservationLedger.push({ gameTime: world.gameTime, itemId: `${giver.id}->${receiver.id}:${kind}`, kind, delta: 0, note: 'handover' });
  giver.stats.gave[kind] = (giver.stats.gave[kind] ?? 0) + quantity;
  return { ok: true };
}

export function takeUnattendedItem(world: Mvp2World, taker: AgentState, item: GroundItem): { ok: boolean; reason?: string } {
  const check = canPickup(world, taker, item);
  if (!check.ok) return check;
  const owner = item.droppedBy ? world.agents[item.droppedBy] : null;
  const knownOwned = !!owner && owner.id !== taker.id && owner.isAlive;
  const res = pickupItem(world, taker, item);
  if (res.ok) {
    taker.stats.tookUnattended++;
    // Social memory: witnesses and owner form their own interpretation.
    const observers = [...item.seenBy, ...(owner ? [owner.id] : [])].filter((id) => id !== taker.id);
    world.events.push({
      eventId: `evt_${world.eventSeq++}`,
      worldId: world.worldId,
      gameTime: world.gameTime,
      type: knownOwned ? 'item_taken_owned' : 'item_taken',
      actorId: taker.id,
      targetId: item.itemId,
      locationId: `${item.x},${item.y}`,
      payload: { kind: item.kind, quantity: item.quantity, knownOwned },
      observers,
      salience: knownOwned ? 8 : 4,
    });
  }
  return res;
}

export function searchWreckage(world: Mvp2World, agent: AgentState, wreckId: string): Array<{ kind: ItemKind; quantity: number }> {
  const wreck = world.wrecks[wreckId];
  if (!wreck || wreck.searched) return [];
  wreck.searched = true;
  const found: Array<{ kind: ItemKind; quantity: number }> = [];
  for (const [kind, qty] of Object.entries(wreck.contents)) {
    const k = kind as ItemKind;
    if ((qty ?? 0) > 0) {
      found.push({ kind: k, quantity: qty ?? 0 });
      spawnGroundItem(world, k, qty ?? 0, wreck.x + 1, wreck.y, 'wreckage', undefined, `from ${wreckId}`);
      delete wreck.contents[k];
    }
  }
  return found;
}
