// WorldState factory: initial conditions from ScenarioConfig + fixtures.

import { generateIslandMap, type MapObjects } from './map';
import { getProfile } from './profile';
import { Rng } from './rng';
import { defaultScenario } from './scenario';
import type { AgentState, FixtureId, IslandMap, ResourceNode, ScenarioConfig, WorldState } from './types';

export function createWorld(
  worldId: string,
  fixture: FixtureId = 'FX-BASE',
  overrides: Partial<ScenarioConfig> = {},
  llmMode: ScenarioConfig['llm']['mode'] = 'mock',
): { world: WorldState; mapObjects: MapObjects } {
  const scenario = defaultScenario(fixture, { ...overrides, llm: { ...defaultScenario(fixture).llm, ...overrides.llm, mode: llmMode } });
  const { map, objects } = generateIslandMap(scenario.seed, {
    springInitial: scenario.initialConditions.springInitial,
    groveStock: scenario.initialConditions.groveStock,
  });
  return { world: buildWorld(worldId, scenario, map, objects), mapObjects: objects };
}

export function buildWorld(
  worldId: string,
  scenario: ScenarioConfig,
  map: IslandMap,
  objects: MapObjects,
): WorldState {
  const agents: Record<string, AgentState> = {};
  const profileIds = ['agent_a', 'agent_b', 'agent_c'];
  const needAccel = scenario.initialConditions.accelerateNeedsFor;

  profileIds.forEach((pid, i) => {
    const profile = getProfile(pid);
    const pos = objects.spawnPoints[i % objects.spawnPoints.length];
    const isDeathBagTarget = needAccel === pid;
    agents[pid] = {
      id: pid,
      name: profile.name,
      profileId: pid,
      position: { ...pos },
      facing: { x: 1, y: 0 },
      needs: {
        water: 65,
        food: 75,
        stamina: 90,
        health: isDeathBagTarget ? 30 : 100,
      },
      inventory: { water: 0, food: 0 },
      // Directional zones are common knowledge (they are directions, not secrets);
      // resource nodes stay hidden until discovered (PRD 6.4).
      knownLocations: ['crash_camp', 'north_ridge_zone', 'east_coast_zone', 'south_zone', 'west_zone'],
      exploredZones: [],
      knowledgeFacts: [
        {
          factId: `fact_${pid}_camp`,
          ownerId: pid,
          factType: 'location',
          targetId: 'crash_camp',
          value: '坠机营地位于我们身后，有公共储物箱。',
          source: 'observation',
          confidence: 1,
          verified: true,
          gameTime: 0,
        },
      ],
      relationships: {},
      promises: [],
      recentEvents: [],
      strategy: { label: '观望', windowStart: 0 },
      isAlive: true,
      stress: 10,
      fear: 5,
      desperation: 0,
      perceivedScarcity: 20,
      socialSecurity: 50,
      grievance: {},
      stats: {
        harvested: { water: 0, food: 0 },
        consumed: { water: 0, food: 0 },
        given: { water: 0, food: 0 },
        storedToPublic: { water: 0, food: 0 },
        takenFromPublic: { water: 0, food: 0 },
        received: { water: 0, food: 0 },
        requestsMade: 0,
        requestsReceived: 0,
        refusalsMade: 0,
        promisesFulfilled: 0,
        promisesBroken: 0,
        locationsShared: 0,
        wasted: { water: 0, food: 0 },
      },
      decisionCount: 0,
      lastDecisionTime: -999,
      invalidActionStreak: 0,
    };
  });

  // Relationships are bidirectional; init from each side.
  for (const pid of profileIds) {
    for (const other of profileIds) {
      if (pid === other) continue;
      agents[pid].relationships[other] = {
        fromId: pid,
        toId: other,
        trust: 0,
        resentment: 0,
        dependency: 0,
        affinity: 0,
        updatedAt: 0,
        deltas: [],
      };
    }
  }

  const resources: Record<string, ResourceNode> = {};
  for (const node of objects.resourceNodes) {
    resources[node.id] = { ...node, discoveredBy: [], harvestHistory: [] };
  }

  const containers = {
    camp_crate: {
      id: 'camp_crate',
      kind: 'camp_crate' as const,
      position: { x: 20, y: 24 },
      inventory: {
        water: scenario.initialConditions.emergencyWater,
        food: scenario.initialConditions.emergencyFood,
      },
    },
  };

  // FX-WATER-SECRET: agent A holds a private, unverified belief about the spring.
  if (scenario.initialConditions.waterSecretFor) {
    const holder = scenario.initialConditions.waterSecretFor;
    agents[holder].knownLocations.push('water_spring_01');
    agents[holder].knowledgeFacts.push({
      factId: `fact_${holder}_spring_clue`,
      ownerId: holder,
      factType: 'belief',
      targetId: 'water_spring_01',
      value: '坠机前我隐约看到东北方向的地形有淡水迹象，泉水可能在那边。',
      source: 'inference',
      confidence: 0.6,
      verified: false,
      gameTime: 0,
    });
  }

  // FX-CONTENTION: A and B start near the spring, both knowing it.
  const contention = scenario.initialConditions.contentionAt;
  if (contention) {
    const spots: Record<string, { x: number; y: number }> = {
      agent_a: { x: 29, y: 13 },
      agent_b: { x: 31, y: 14 },
    };
    for (const aid of contention.agents) {
      if (!agents[aid]) continue;
      agents[aid].position = { ...spots[aid] };
      if (!agents[aid].knownLocations.includes('water_spring_01')) {
        agents[aid].knownLocations.push('water_spring_01');
      }
      agents[aid].needs.water = 55;
    }
  }

  // FX-PROMISE-CRISIS: B has made a water promise to C, then faces a crisis.
  if (scenario.initialConditions.promiseCrisisFor) {
    const promiser = scenario.initialConditions.promiseCrisisFor;
    agents[promiser].needs.water = 38;
    agents[promiser].needs.health = 50;
    const promise = {
      promiseId: 'promise_seed_1',
      promiserId: promiser,
      recipientId: 'agent_c',
      actionType: 'give' as const,
      resource: 'water' as const,
      amount: 1,
      deadline: 10 * 60, // day1 10:00
      createdAt: 0,
      status: 'pending' as const,
      sourceEventId: 'evt_seed_promise',
    };
    agents[promiser].promises.push(promise);
  }

  const world: WorldState = {
    worldId,
    worldVersion: 1,
    gameTime: 0,
    status: 'setup',
    scenario,
    map,
    agents,
    resources,
    containers,
    events: [],
    conversations: {},
    relationshipHistory: {
      agent_a: { agent_b: [], agent_c: [] },
      agent_b: { agent_a: [], agent_c: [] },
      agent_c: { agent_a: [], agent_b: [] },
    },
    promiseLedger: agents[scenario.initialConditions.promiseCrisisFor ?? '']?.promises ?? [],
    operationIds: new Set(),
    rngState: scenario.seed,
    rng: new Rng(scenario.seed ^ 0x51a7),
    decisionFreeze: false,
    llmUsage: { calls: [], summary: emptyUsageSummary() },
  };
  return world;
}

export function emptyUsageSummary() {
  return {
    plannerCalls: 0,
    dialogueCalls: 0,
    repairCalls: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCachedTokens: 0,
    totalCostUsd: 0,
    p95LatencyMs: 0,
    avgLatencyMs: 0,
  };
}

export function agentIds(): string[] {
  return ['agent_a', 'agent_b', 'agent_c'];
}
