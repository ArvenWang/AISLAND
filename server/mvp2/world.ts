// MVP2 world initialization from the compiled map: agents on the south beach,
// ground items, wrecks and resources from SemanticObjects (PRD 4.2, 10).

import { RuntimeMap } from '../engine/map/runtimeMap';
import { CognitiveMap } from '../engine/perception/cognitiveMap';
import { computeFov, fovRadiusAt } from '../engine/perception/fov';
import { AgentState, ItemKind, Mvp2World } from './types';
import { createWorldState } from './engine';

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

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMvp2World(worldId: string, seed: number, map: RuntimeMap): Mvp2World {
  const rng = mulberry(seed ^ 0x9e3779b9);
  const agents: AgentState[] = PROFILE_IDS.map((id, i) => {
    const sp = map.spawnPoint(i);
    return {
      id,
      profileId: id,
      name: NAMES[id],
      x: sp.x,
      y: sp.y,
      facing: { x: 0, y: 1 },
      needs: { water: 70, food: 74, stamina: 92, health: 100, sleepNeed: 22 },
      mental: { mentalStability: 80, fear: 12, socialSafety: 50 },
      inventory: {},
      carryUsed: 0,
      isAlive: true,
      cognitive: new CognitiveMap(map, sp.x, sp.y),
      currentAction: null,
      sleep: null,
      knowledge: { introducedTo: [], knownItems: [], knownFires: [], knownResources: [], claimsHeard: [] },
      relationships: {},
      plan: null,
      stats: { harvested: {}, consumed: {}, gave: {}, tookUnattended: 0, promisesKept: 0, promisesBroken: 0 },
      decisions: 0,
      lastDecisionAt: 0,
      needsHistory: [{ t: 0, water: 70, food: 74 }],
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

  // Wrecks with seeded contents.
  let wi = 0;
  for (const o of map.objectsOfType('wreckage')) {
    const contents: Partial<Record<ItemKind, number>> = {};
    const water = 3 + Math.floor(rng() * 2);
    const food = 2 + Math.floor(rng() * 1);
    contents.water = water;
    contents.food = food;
    if (rng() < 0.35) contents.wood = 1;
    world.wrecks[`wreck_${++wi}`] = { wreckId: `wreck_${wi}`, x: o.cellX, y: o.cellY, searched: false, contents };
  }

  // Resources from semantic objects.
  for (const o of map.objectsOfType('water_spring')) {
    world.resources[`spring_${o.id}`] = { resourceId: `spring_${o.id}`, kind: 'spring', x: o.cellX, y: o.cellY, stock: Number(o.properties.capacity ?? 60), capacity: Number(o.properties.capacity ?? 60), regenPerHour: Number(o.properties.regenPerIslandHour ?? 3), depletedAppearance: false };
  }
  for (const o of map.objectsOfType('berry_bush')) {
    world.resources[`berry_${o.id}`] = { resourceId: `berry_${o.id}`, kind: 'berry_bush', x: o.cellX, y: o.cellY, stock: Number(o.properties.capacity ?? 6), capacity: Number(o.properties.capacity ?? 6), regenPerHour: Number(o.properties.regenPerIslandHour ?? 0.4), depletedAppearance: false };
  }
  for (const o of map.objectsOfType('wood_pile')) {
    world.resources[`wood_${o.id}`] = { resourceId: `wood_${o.id}`, kind: 'wood_pile', x: o.cellX, y: o.cellY, stock: Number(o.properties.capacity ?? 4), capacity: Number(o.properties.capacity ?? 4), regenPerHour: Number(o.properties.regenPerIslandHour ?? 0.1), depletedAppearance: false };
  }

  // Initial vision at spawn.
  for (const a of agents) {
    const visible = computeFov(map, a.x, a.y, fovRadiusAt(map, a.x, a.y, { light: 'day' }));
    a.cognitive.updateVision(visible, 0, { x: a.x, y: a.y });
  }
  return world;
}
