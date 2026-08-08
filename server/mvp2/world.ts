// MVP2 world initialization from the compiled map: agents on the south beach,
// ground items, wrecks and resources from SemanticObjects (PRD 4.2, 10).

import { RuntimeMap } from '../engine/map/runtimeMap';
import { CognitiveMap } from '../engine/perception/cognitiveMap';
import { computeFov, fovRadiusAt } from '../engine/perception/fov';
import { AgentState, ItemKind, Mvp2World } from './types';
import { createWorldState, updateAgentEncounters, WORLD_START_TIME } from './engine';

const PROFILE_IDS = ['agent_a', 'agent_b', 'agent_c'];
const NAMES: Record<string, string> = { agent_a: '林澈', agent_b: '石磊', agent_c: '苏禾' };

const ITEM_KIND_MAP: Record<string, ItemKind> = {
  water_bottle: 'water',
  food_ration: 'food',
  lighter: 'lighter',
  tinder: 'tinder',
  backpack: 'backpack',
  wood_log: 'wood',
};

const ITEM_QTY: Record<string, number> = {
  water_bottle: 1,
  food_ration: 1,
  lighter: 1,
  tinder: 1,
  backpack: 1,
  wood_log: 1,
};

export function createMvp2World(worldId: string, seed: number, map: RuntimeMap): Mvp2World {
  const agents: AgentState[] = PROFILE_IDS.map((id, i) => {
    const sp = map.spawnPoint(i);
    return {
      id,
      profileId: id,
      name: NAMES[id],
      x: sp.x,
      y: sp.y,
      facing: { x: 0, y: 1 },
      needs: { water: 90, food: 90, stamina: 86, health: 100, sleepNeed: 20 },
      mental: { mentalStability: 82, fear: 14, socialSafety: 50 },
      inventory: {},
      carryUsed: 0,
      isAlive: true,
      cognitive: new CognitiveMap(map, sp.x, sp.y),
      currentAction: null,
      sleep: null,
      knowledge: { introducedTo: [], knownItems: [], knownFires: [], knownResources: [], claimsHeard: [] },
      relationships: {},
      plan: null,
      privateMotive: '',
      recentObservedEventIds: [],
      episodicMemories: [],
      beliefs: [],
      reflections: [],
      relationshipEvidence: [],
      pendingOfferIds: [],
      lastReflectionDay: 1,
      stats: { harvested: {}, consumed: {}, gave: {}, tookUnattended: 0, promisesKept: 0, promisesBroken: 0 },
      decisions: 0,
      lastDecisionAt: 0,
      needsHistory: [{ t: WORLD_START_TIME, water: 90, food: 90 }],
    };
  });
  const world = createWorldState(worldId, seed, map, agents);

  // Ground items from map item_spawn objects.
  for (const o of map.objectsOfType('item_spawn')) {
    const kind = ITEM_KIND_MAP[String(o.properties.itemKind ?? '')];
    if (!kind) continue;
    const qty = ITEM_QTY[String(o.properties.itemKind)] ?? 1;
    world.groundItems[`item_${world.actionSeq++}`] = {
      itemId: `item_${world.actionSeq - 1}`,
      kind,
      quantity: qty,
      x: o.cellX,
      y: o.cellY,
      source: 'wreckage',
      seenBy: [],
      claimRecords: [],
      createdAt: 0,
    };
    world.conservationLedger.push({ gameTime: 0, itemId: `item_${world.actionSeq - 1}`, kind, delta: qty, note: 'map_spawn' });
  }

  // Wreck contents are authored in the TMJ. The source map deliberately
  // carries the exact beach inventory, so a seed must not silently change
  // the opening economy.
  let wi = 0;
  for (const o of [...map.objectsOfType('wreck_main'), ...map.objectsOfType('wreckage')]) {
    const contents: Partial<Record<ItemKind, number>> = {};
    const water = Number(o.properties.waterUnits ?? 0);
    const food = Number(o.properties.foodUnits ?? 0);
    if (water > 0) contents.water = water;
    if (food > 0) contents.food = food;
    const wood = Number(o.properties.woodUnits ?? 0);
    if (wood > 0) contents.wood = wood;
    world.wrecks[`wreck_${++wi}`] = { wreckId: `wreck_${wi}`, x: o.cellX, y: o.cellY, searched: false, contents };
    for (const [kind, quantity] of Object.entries(contents)) {
      world.conservationLedger.push({ gameTime: 0, itemId: `wreck_${wi}`, kind, delta: quantity ?? 0, note: 'map_wreck_spawn' });
    }
  }

  // Resources from semantic objects.
  for (const o of map.objectsOfType('water_spring')) {
    const capacity = Number(o.properties.capacity ?? 60);
    world.resources[`spring_${o.id}`] = { resourceId: `spring_${o.id}`, kind: 'spring', x: o.cellX, y: o.cellY, stock: capacity, capacity, regenPerHour: Number(o.properties.regenPerIslandHour ?? 3), depletedAppearance: false };
    world.conservationLedger.push({ gameTime: 0, itemId: `spring_${o.id}`, kind: 'water', delta: capacity, note: 'map_resource_spawn' });
  }
  for (const o of map.objectsOfType('berry_bush')) {
    const capacity = Number(o.properties.capacity ?? 6);
    world.resources[`berry_${o.id}`] = { resourceId: `berry_${o.id}`, kind: 'berry_bush', x: o.cellX, y: o.cellY, stock: capacity, capacity, regenPerHour: Number(o.properties.regenPerIslandHour ?? 0.4), depletedAppearance: false };
    world.conservationLedger.push({ gameTime: 0, itemId: `berry_${o.id}`, kind: 'food', delta: capacity, note: 'map_resource_spawn' });
  }
  for (const o of map.objectsOfType('wood_pile')) {
    const capacity = Number(o.properties.capacity ?? 4);
    world.resources[`wood_${o.id}`] = { resourceId: `wood_${o.id}`, kind: 'wood_pile', x: o.cellX, y: o.cellY, stock: capacity, capacity, regenPerHour: Number(o.properties.regenPerIslandHour ?? 0.1), depletedAppearance: false };
    world.conservationLedger.push({ gameTime: 0, itemId: `wood_${o.id}`, kind: 'wood', delta: capacity, note: 'map_resource_spawn' });
  }

  // Initial vision at spawn.
  for (const a of agents) {
    const visible = computeFov(map, a.x, a.y, fovRadiusAt(map, a.x, a.y, { light: 'day' }));
    a.cognitive.updateVision(visible, 0, { x: a.x, y: a.y });
  }
  updateAgentEncounters(world);
  return world;
}
