import 'dotenv/config';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { lightPhaseAt } from '../../server/engine/perception/lighting';
import { LlmAdapter } from '../../server/llm/adapter';
import { decideAgents, stepWorldMovement, WORLD_START_TIME } from '../../server/mvp2/engine';
import { RealLlmBrain, type LlmLike } from '../../server/mvp2/planner';
import type { Mvp2World } from '../../server/mvp2/types';
import { createMvp2World } from '../../server/mvp2/world';

const root = process.cwd();
const outputDir = path.join(root, 'acceptance', 'phase31', 'counterfactual-real');
const pairSeeds = [73001, 73002, 73003];
const variants = ['baseline', 'reduced_water'] as const;
const shortHorizon = WORLD_START_TIME + 36 * 60;
const stepMinutes = 5;
const argv = process.argv.slice(2);
const auditOnly = argv.includes('--audit-only');
const concurrency = Math.max(1, Math.min(3, Number(argValue('--concurrency') ?? 3)));

type Variant = (typeof variants)[number];

type CounterfactualSummary = {
  pairId: string;
  variant: Variant;
  seed: number;
  mapVersion: string;
  profileIds: string[];
  declaredVariable: 'loose_opening_water_units';
  looseOpeningWaterUnits: number;
  horizonGameTime: number;
  finalGameTime: number;
  alive: number;
  meanWater: number;
  meanFood: number;
  messages: number;
  conversationsAtLeastTwoTurns: number;
  bilateralEvents: number;
  looseWaterPickups: number;
  harvestedWater: number;
  consumedWater: number;
  actionHistogram: Record<string, number>;
  actionSequence: string[];
  planGoals: string[];
  llmCalls: number;
  llmStatuses: Record<string, number>;
  providers: string[];
  models: string[];
  provenanceCoverage: number;
};

type CounterfactualBundle = {
  schema: 'aisland.phase31.counterfactual_run.v1';
  identity: {
    pairId: string;
    variant: Variant;
    seed: number;
    provider: string;
    model: string;
    mode: 'real';
    mapVersion: string;
    profileIds: string[];
    changedVariables: ['loose_opening_water_units'];
    controlFingerprint: string;
  };
  intervention: { before: 4; after: 4 | 2; removedItemIds: string[] };
  summary: CounterfactualSummary;
  evidence: {
    llmLedger: Mvp2World['llmLedger'];
    actionEvents: Array<{ eventId: string; actorId?: string; type: string; llmRequestId?: string; gameTime: number }>;
    planEvents: Array<{ eventId: string; actorId?: string; oldGoal?: string; newGoal?: string; llmRequestId?: string; gameTime: number }>;
    outcomeEvents: Array<{ eventId: string; type: string; actorId?: string; targetId?: string; gameTime: number }>;
    finalAgents: Array<{ id: string; isAlive: boolean; water: number; food: number; health: number }>;
  };
};

function argValue(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function makeBrain(seed: number): RealLlmBrain {
  const scenario = {
    seed,
    llm: {
      provider: process.env.LLM_PROVIDER ?? 'deepseek',
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      mode: 'real',
      temperature: 0,
      maxTokens: 900,
      timeoutMs: 25_000,
      injectInvalidJsonRate: 0,
      injectTimeoutRate: 0,
      inject429Rate: 0,
    },
  };
  const adapter = new LlmAdapter(scenario as never);
  const zeroTemperatureAdapter: LlmLike = {
    chat: (messages, options) => adapter.chat(messages, { ...options, temperature: 0 }),
  };
  return new RealLlmBrain(zeroTemperatureAdapter);
}

function bundlePath(pairIndex: number, variant: Variant): string {
  return path.join(outputDir, `pair-${String(pairIndex + 1).padStart(2, '0')}-${variant}.json`);
}

function readBundle(pairIndex: number, variant: Variant): CounterfactualBundle | null {
  const file = bundlePath(pairIndex, variant);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CounterfactualBundle;
    return parsed.schema === 'aisland.phase31.counterfactual_run.v1' && parsed.summary.finalGameTime >= shortHorizon ? parsed : null;
  } catch {
    return null;
  }
}

function applyIntervention(world: Mvp2World, variant: Variant): string[] {
  if (variant === 'baseline') return [];
  const looseWater = Object.values(world.groundItems)
    .filter((item) => item.kind === 'water' && item.source === 'wreckage')
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (looseWater.length !== 4) throw new Error(`expected exactly 4 loose opening water units, found ${looseWater.length}`);
  const removed = looseWater.slice(-2);
  for (const item of removed) {
    delete world.groundItems[item.itemId];
    world.conservationLedger.push({ gameTime: world.gameTime, itemId: item.itemId, kind: 'water', delta: -item.quantity, note: 'counterfactual_loose_opening_water_reduction' });
  }
  return removed.map((item) => item.itemId);
}

function controlFingerprint(world: Mvp2World): string {
  const controlledState = {
    seed: world.seed,
    map: { version: world.map.data.version, width: world.map.width, height: world.map.height },
    agents: Object.values(world.agents).map((agent) => ({ id: agent.id, profileId: agent.profileId, x: agent.x, y: agent.y, needs: agent.needs })),
    resources: Object.values(world.resources).map((resource) => ({ ...resource })).sort((a, b) => a.resourceId.localeCompare(b.resourceId)),
    wrecks: Object.values(world.wrecks).map((wreck) => ({ ...wreck })).sort((a, b) => a.wreckId.localeCompare(b.wreckId)),
    nonInterventionGroundItems: Object.values(world.groundItems)
      .filter((item) => !(item.kind === 'water' && item.source === 'wreckage'))
      .map((item) => ({ itemId: item.itemId, kind: item.kind, quantity: item.quantity, x: item.x, y: item.y, source: item.source }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId)),
  };
  return createHash('sha256').update(JSON.stringify(controlledState)).digest('hex');
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function summarize(world: Mvp2World, pairIndex: number, variant: Variant, openingWaterUnits: 4 | 2): CounterfactualSummary {
  const actionEvents = world.events.filter((event) => event.type === 'action_started' && event.payload.provenanceKind === 'llm');
  const successfulRequests = new Set(world.llmLedger.filter((entry) => entry.status === 'ok').map((entry) => entry.llmRequestId));
  const linkedActions = actionEvents.filter((event) => typeof event.payload.llmRequestId === 'string' && successfulRequests.has(event.payload.llmRequestId)).length;
  const agents = Object.values(world.agents);
  const conversations = Object.values(world.conversations);
  const bilateralFacts = Object.values(world.socialFacts).filter((fact) => ['offer', 'request', 'joint_intent'].includes(fact.kind)).length;
  const bilateralWorldEvents = world.events.filter((event) => ['handover_refused', 'handover_completed', 'item_taken_owned'].includes(event.type)).length;
  const statusCounts = countBy(world.llmLedger.map((entry) => entry.status));
  return {
    pairId: `pair_${String(pairIndex + 1).padStart(2, '0')}`,
    variant,
    seed: pairSeeds[pairIndex],
    mapVersion: world.map.data.version,
    profileIds: agents.map((agent) => agent.profileId),
    declaredVariable: 'loose_opening_water_units',
    looseOpeningWaterUnits: openingWaterUnits,
    horizonGameTime: shortHorizon,
    finalGameTime: world.gameTime,
    alive: agents.filter((agent) => agent.isAlive).length,
    meanWater: round(agents.reduce((sum, agent) => sum + agent.needs.water, 0) / agents.length),
    meanFood: round(agents.reduce((sum, agent) => sum + agent.needs.food, 0) / agents.length),
    messages: world.events.filter((event) => event.type === 'message_spoken').length,
    conversationsAtLeastTwoTurns: conversations.filter((conversation) => conversation.turns.length >= 2).length,
    bilateralEvents: bilateralFacts + bilateralWorldEvents,
    looseWaterPickups: world.events.filter((event) => event.type === 'item_picked_up' && event.payload.kind === 'water').length,
    harvestedWater: world.events.filter((event) => event.type === 'resource_harvested' && event.payload.kind === 'water').length,
    consumedWater: world.events.filter((event) => event.type === 'consumed' && event.payload.kind === 'water').length,
    actionHistogram: countBy(actionEvents.map((event) => String(event.payload.type ?? 'unknown'))),
    actionSequence: actionEvents.slice(0, 18).map((event) => `${event.actorId}:${String(event.payload.type ?? 'unknown')}`),
    planGoals: world.events.filter((event) => event.type === 'plan_replanned').slice(0, 18).map((event) => `${event.actorId}:${String(event.payload.newGoal ?? '')}`),
    llmCalls: world.llmLedger.length,
    llmStatuses: statusCounts,
    providers: [...new Set(world.llmLedger.map((entry) => entry.provider))],
    models: [...new Set(world.llmLedger.map((entry) => entry.model))],
    provenanceCoverage: round(linkedActions / Math.max(1, actionEvents.length), 4),
  };
}

async function runOne(pairIndex: number, variant: Variant): Promise<CounterfactualBundle> {
  const completed = readBundle(pairIndex, variant);
  if (completed) {
    console.log(`[phase31-counterfactual] ${completed.summary.pairId}/${variant} resume`);
    return completed;
  }
  const seed = pairSeeds[pairIndex];
  const pairId = `pair_${String(pairIndex + 1).padStart(2, '0')}`;
  const world = createMvp2World(`phase31_cf_${pairId}_${variant}`, seed, RuntimeMap.loadDefault());
  const fingerprint = controlFingerprint(world);
  const removedItemIds = applyIntervention(world, variant);
  const brain = makeBrain(seed);
  let previousLight: string = lightPhaseAt(world.gameTime);
  const started = Date.now();
  const deadline = started + 20 * 60_000;
  while (world.status === 'running' && world.gameTime < shortHorizon) {
    if (Date.now() > deadline) throw new Error(`${pairId}/${variant} exceeded 20 minute wall timeout`);
    previousLight = stepWorldMovement(world, Math.min(stepMinutes, shortHorizon - world.gameTime));
    await decideAgents(world, brain, previousLight);
  }
  const openingWaterUnits = variant === 'baseline' ? 4 : 2;
  const summary = summarize(world, pairIndex, variant, openingWaterUnits);
  const bundle: CounterfactualBundle = {
    schema: 'aisland.phase31.counterfactual_run.v1',
    identity: {
      pairId,
      variant,
      seed,
      provider: process.env.LLM_PROVIDER ?? 'deepseek',
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      mode: 'real',
      mapVersion: world.map.data.version,
      profileIds: Object.values(world.agents).map((agent) => agent.profileId),
      changedVariables: ['loose_opening_water_units'],
      controlFingerprint: fingerprint,
    },
    intervention: { before: 4, after: openingWaterUnits, removedItemIds },
    summary,
    evidence: {
      llmLedger: world.llmLedger,
      actionEvents: world.events
        .filter((event) => event.type === 'action_started')
        .map((event) => ({ eventId: event.eventId, actorId: event.actorId, type: String(event.payload.type ?? 'unknown'), llmRequestId: typeof event.payload.llmRequestId === 'string' ? event.payload.llmRequestId : undefined, gameTime: event.gameTime })),
      planEvents: world.events
        .filter((event) => event.type === 'plan_replanned')
        .map((event) => ({ eventId: event.eventId, actorId: event.actorId, oldGoal: typeof event.payload.oldGoal === 'string' ? event.payload.oldGoal : undefined, newGoal: typeof event.payload.newGoal === 'string' ? event.payload.newGoal : undefined, llmRequestId: typeof event.payload.llmRequestId === 'string' ? event.payload.llmRequestId : undefined, gameTime: event.gameTime })),
      outcomeEvents: world.events
        .filter((event) => ['message_spoken', 'handover_completed', 'handover_refused', 'item_taken_owned', 'resource_harvested', 'consumed', 'agent_died'].includes(event.type))
        .map((event) => ({ eventId: event.eventId, type: event.type, actorId: event.actorId, targetId: event.targetId, gameTime: event.gameTime })),
      finalAgents: Object.values(world.agents).map((agent) => ({ id: agent.id, isAlive: agent.isAlive, water: round(agent.needs.water), food: round(agent.needs.food), health: round(agent.needs.health) })),
    },
  };
  fs.writeFileSync(bundlePath(pairIndex, variant), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`[phase31-counterfactual] ${pairId}/${variant} complete wall=${round((Date.now() - started) / 1000, 1)}s calls=${summary.llmCalls} alive=${summary.alive} conv2=${summary.conversationsAtLeastTwoTurns}`);
  return bundle;
}

function behaviorSignature(summary: CounterfactualSummary): string {
  return JSON.stringify({
    actions: summary.actionSequence,
    goals: summary.planGoals,
    water: [summary.looseWaterPickups, summary.harvestedWater, summary.consumedWater, summary.meanWater],
    social: [summary.messages, summary.conversationsAtLeastTwoTurns, summary.bilateralEvents],
    outcome: [summary.alive, summary.meanFood],
  });
}

function audit(bundles: CounterfactualBundle[]) {
  const pairs = pairSeeds.map((seed, pairIndex) => ({
    seed,
    baseline: bundles.find((bundle) => bundle.identity.pairId === `pair_${String(pairIndex + 1).padStart(2, '0')}` && bundle.identity.variant === 'baseline'),
    reduced: bundles.find((bundle) => bundle.identity.pairId === `pair_${String(pairIndex + 1).padStart(2, '0')}` && bundle.identity.variant === 'reduced_water'),
  }));
  const completePairs = pairs.filter((pair) => pair.baseline && pair.reduced);
  const realAndProvenanced = bundles.length === 6 && bundles.every((bundle) => {
    const okRequests = new Set(bundle.evidence.llmLedger.filter((entry) => entry.status === 'ok').map((entry) => entry.llmRequestId));
    const llmActions = bundle.evidence.actionEvents.filter((event) => event.llmRequestId);
    return bundle.identity.mode === 'real'
      && bundle.evidence.llmLedger.length === bundle.summary.llmCalls
      && bundle.evidence.llmLedger.length > 0
      && llmActions.length > 0
      && llmActions.every((event) => okRequests.has(event.llmRequestId!))
      && !bundle.evidence.llmLedger.some((entry) => ['mock', 'replay'].includes(entry.provider));
  });
  const pairedIdentity = completePairs.every((pair) => pair.baseline!.identity.seed === pair.reduced!.identity.seed
    && pair.baseline!.identity.mapVersion === pair.reduced!.identity.mapVersion
    && JSON.stringify(pair.baseline!.identity.profileIds) === JSON.stringify(pair.reduced!.identity.profileIds)
    && pair.baseline!.identity.controlFingerprint === pair.reduced!.identity.controlFingerprint);
  const singleVariable = completePairs.every((pair) => pair.baseline!.identity.changedVariables.length === 1
    && pair.reduced!.identity.changedVariables.length === 1
    && pair.baseline!.identity.changedVariables[0] === 'loose_opening_water_units'
    && pair.baseline!.intervention.after === 4
    && pair.reduced!.intervention.after === 2
    && pair.reduced!.intervention.removedItemIds.length === 2);
  const divergentPairs = completePairs.filter((pair) => behaviorSignature(pair.baseline!.summary) !== behaviorSignature(pair.reduced!.summary));
  const gates = {
    'CF-01': { passed: completePairs.length === 3 && realAndProvenanced, detail: `realMatchedPairs=${completePairs.length}/3; bundles=${bundles.length}/6; provenance=${bundles.map((bundle) => bundle.summary.provenanceCoverage).join(',')}` },
    'CF-02': { passed: pairedIdentity && singleVariable, detail: `same map/roles/seed within pair=${pairedIdentity}; only loose_opening_water_units 4->2=${singleVariable}` },
    'CF-03': { passed: divergentPairs.length >= 2, detail: `pairsWithChangedPlansActionsOrOutcome=${divergentPairs.length}/3` },
    'CF-04': { passed: bundles.every((bundle) => bundle.identity.profileIds.join(',') === 'agent_a,agent_b,agent_c'), detail: 'all variants retain the production profiles; no cooperation/competition persona was injected' },
  };
  return {
    schema: 'aisland.phase31.counterfactual_report.v1',
    generatedAt: new Date().toISOString(),
    passed: Object.values(gates).every((gate) => gate.passed),
    variable: { name: 'loose_opening_water_units', baseline: 4, treatment: 2 },
    horizonIslandHours: 36,
    gates,
    pairComparisons: completePairs.map((pair) => ({
      seed: pair.seed,
      baseline: pair.baseline!.summary,
      reducedWater: pair.reduced!.summary,
      behaviorChanged: behaviorSignature(pair.baseline!.summary) !== behaviorSignature(pair.reduced!.summary),
    })),
  };
}

async function pool(tasks: Array<{ pairIndex: number; variant: Variant }>, workers: number): Promise<CounterfactualBundle[]> {
  const results = new Array<CounterfactualBundle>(tasks.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index];
      results[index] = await runOne(task.pairIndex, task.variant);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, () => worker()));
  return results;
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  if (!process.env.LLM_API_KEY && !auditOnly) throw new Error('LLM_API_KEY is required for Phase 3.1 counterfactual acceptance');
  const tasks = pairSeeds.flatMap((_, pairIndex) => variants.map((variant) => ({ pairIndex, variant })));
  const bundles = auditOnly
    ? tasks.map((task) => readBundle(task.pairIndex, task.variant)).filter((bundle): bundle is CounterfactualBundle => bundle !== null)
    : await pool(tasks, concurrency);
  const report = audit(bundles);
  fs.writeFileSync(path.join(outputDir, 'counterfactual-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const [gate, result] of Object.entries(report.gates)) console.log(`[phase31-counterfactual] ${gate} ${result.passed ? 'PASS' : 'FAIL'} ${result.detail}`);
  console.log(`[phase31-counterfactual] report=${path.join(outputDir, 'counterfactual-report.json')}`);
  if (!report.passed) process.exitCode = 1;
}

void main();
