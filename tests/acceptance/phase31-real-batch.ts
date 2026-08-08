import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { lightPhaseAt } from '../../server/engine/perception/lighting';
import { LlmAdapter } from '../../server/llm/adapter';
import { decideAgents, stepWorldMovement, WORLD_END_TIME, WORLD_START_TIME } from '../../server/mvp2/engine';
import { RealLlmBrain } from '../../server/mvp2/planner';
import type { LlmProvenance, Mvp2World, WorldEvent } from '../../server/mvp2/types';
import { createMvp2World } from '../../server/mvp2/world';

const root = process.cwd();
const outputDir = path.join(root, 'acceptance', 'phase31', 'real-api');
const seeds = [31415, 27182, 16180, 14142, 17320, 22360];
const argv = process.argv.slice(2);
const requestedRuns = Math.max(1, Math.min(seeds.length, Number(argValue('--runs') ?? seeds.length)));
const concurrency = Math.max(1, Math.min(3, Number(argValue('--concurrency') ?? 2)));
const auditOnly = argv.includes('--audit-only');
const stepMinutes = 5;

type DailySnapshot = {
  day: number;
  gameTime: number;
  alive: number;
  agents: Array<{ id: string; isAlive: boolean; water: number; food: number; stamina: number; health: number; x: number; y: number }>;
  conversations: number;
  socialFacts: number;
  llmCalls: number;
};

type CausalChain = {
  chainId: string;
  agentId: string;
  trigger: { eventId: string; observed: boolean; description: string };
  memory: { memoryId: string; summary: string };
  beliefChange: { beliefId?: string; about?: string; before: string; after: string };
  planChange: { eventId: string; oldPlanId?: string; oldGoal?: string; newPlanId?: string; newGoal?: string };
  visibleAction: { eventId: string; type: string; sourceActionId?: string };
  laterReference: { decisionId: string; memoryRefs: string[]; beliefRefs: string[] };
};

type RunSummary = {
  runId: string;
  seed: number;
  status: string;
  endedReason?: string;
  gameTime: number;
  wallSeconds: number;
  aliveAtEnd: number;
  firstDayDeaths: number;
  aliveAtDay3: number;
  conversationsAtLeastTwoTurns: number;
  maxConversationTurns: number;
  bilateralSocialEvents: number;
  messageCount: number;
  repetitionIncidents: number;
  repetitionRatio: number;
  causalChains: number;
  persistentPlansWithTwoSteps: number;
  llmCalls: number;
  llmStatuses: Record<string, number>;
  providers: string[];
  models: string[];
  behaviorActions: number;
  actionsWithProvenance: number;
  provenanceCoverage: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  deaths: Array<{ agentId: string; gameTime: number; cause: string; needs: unknown }>;
  unexplainedDeaths: number;
};

type RunBundle = {
  schema: 'aisland.phase31.real_api_run_bundle.v1';
  identity: { runId: string; seed: number; provider: string; model: string; mode: 'real'; mapVersion: string };
  dailySnapshots: DailySnapshot[];
  causalChains: CausalChain[];
  summary: RunSummary;
  world: Record<string, unknown>;
};

function argValue(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function makeBrain(seed: number): RealLlmBrain {
  const scenario = {
    seed,
    llm: {
      provider: process.env.LLM_PROVIDER ?? 'deepseek',
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      mode: 'real',
      temperature: 0.6,
      maxTokens: 900,
      timeoutMs: 25_000,
      injectInvalidJsonRate: 0,
      injectTimeoutRate: 0,
      inject429Rate: 0,
    },
  };
  return new RealLlmBrain(new LlmAdapter(scenario as never));
}

function snapshot(world: Mvp2World, day: number): DailySnapshot {
  return {
    day,
    gameTime: world.gameTime,
    alive: Object.values(world.agents).filter((agent) => agent.isAlive).length,
    agents: Object.values(world.agents).map((agent) => ({
      id: agent.id,
      isAlive: agent.isAlive,
      water: round(agent.needs.water),
      food: round(agent.needs.food),
      stamina: round(agent.needs.stamina),
      health: round(agent.needs.health),
      x: agent.x,
      y: agent.y,
    })),
    conversations: Object.keys(world.conversations).length,
    socialFacts: Object.keys(world.socialFacts).length,
    llmCalls: world.llmLedger.length,
  };
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function description(world: Mvp2World, event: WorldEvent): string {
  const actor = event.actorId ? world.agents[event.actorId]?.name ?? event.actorId : 'environment';
  const target = event.targetId ? world.agents[event.targetId]?.name ?? event.targetId : '';
  return `${actor}:${event.type}${target ? `:${target}` : ''}`;
}

function extractCausalChains(world: Mvp2World): CausalChain[] {
  const chains: CausalChain[] = [];
  for (const decision of world.llmLedger) {
    if (decision.status !== 'ok' || !decision.memoryRefs?.length) continue;
    const agent = world.agents[decision.agentId];
    if (!agent) continue;
    const planEvent = world.events.find((event) => event.type === 'plan_replanned' && event.actorId === agent.id && event.payload.llmRequestId === decision.llmRequestId && typeof event.payload.oldPlanId === 'string');
    const actionEvent = world.events.find((event) => event.type === 'action_started' && event.actorId === agent.id && event.payload.llmRequestId === decision.llmRequestId);
    if (!planEvent || !actionEvent) continue;
    for (const memoryId of decision.memoryRefs) {
      const memory = agent.episodicMemories.find((candidate) => candidate.memoryId === memoryId);
      if (!memory) continue;
      const trigger = world.events.find((event) => memory.sourceEventIds.includes(event.eventId));
      if (!trigger || trigger.gameTime > decision.gameTime || !trigger.observers.includes(agent.id)) continue;
      const belief = agent.beliefs.find((candidate) => candidate.sourceEventIds.some((eventId) => memory.sourceEventIds.includes(eventId)));
      const committed = world.events.find((event) => event.sourceActionId === actionEvent.sourceActionId && event.eventId !== actionEvent.eventId && !['action_rejected', 'action_started'].includes(event.type));
      chains.push({
        chainId: `chain_${decision.llmRequestId}_${memoryId}`,
        agentId: agent.id,
        trigger: { eventId: trigger.eventId, observed: true, description: description(world, trigger) },
        memory: { memoryId: memory.memoryId, summary: memory.summary },
        beliefChange: { beliefId: belief?.beliefId, about: belief?.aboutAgentId, before: 'unreferenced', after: belief?.proposition ?? 'remembered_and_referenced' },
        planChange: {
          eventId: planEvent.eventId,
          oldPlanId: stringValue(planEvent.payload.oldPlanId),
          oldGoal: stringValue(planEvent.payload.oldGoal),
          newPlanId: stringValue(planEvent.payload.newPlanId),
          newGoal: stringValue(planEvent.payload.newGoal),
        },
        visibleAction: { eventId: committed?.eventId ?? actionEvent.eventId, type: committed?.type ?? String(actionEvent.payload.type ?? 'action_started'), sourceActionId: actionEvent.sourceActionId },
        laterReference: { decisionId: decision.llmRequestId, memoryRefs: decision.memoryRefs ?? [], beliefRefs: decision.beliefRefs ?? [] },
      });
      if (chains.length >= 20) return chains;
    }
  }
  return chains;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function statusCounts(ledger: LlmProvenance[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of ledger) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}

function buildSummary(world: Mvp2World, runId: string, seed: number, wallSeconds: number, chains: CausalChain[]): RunSummary {
  const deaths = world.events
    .filter((event) => event.type === 'agent_died' && event.actorId)
    .map((event) => ({ agentId: event.actorId!, gameTime: event.gameTime, cause: String(event.payload.cause ?? 'unknown'), needs: event.payload.needs }));
  const conversations = Object.values(world.conversations);
  const messages = world.events.filter((event) => event.type === 'message_spoken');
  const planCompletions = new Map<string, number>();
  for (const event of world.events.filter((candidate) => candidate.type === 'plan_step_completed')) {
    const planId = String(event.payload.planId ?? '');
    if (planId) planCompletions.set(planId, (planCompletions.get(planId) ?? 0) + 1);
  }
  const bilateralFacts = Object.values(world.socialFacts).filter((fact) => ['offer', 'request', 'joint_intent'].includes(fact.kind)).length;
  const bilateralEvents = world.events.filter((event) => ['handover_refused', 'handover_completed', 'item_taken_owned'].includes(event.type)).length;
  const bilateralApproaches = world.events.filter((event) => event.type === 'action_started'
    && event.payload.type === 'approach'
    && ['talk', 'offer_item'].includes(String(event.payload.targetType ?? ''))).length;
  const actions = world.events.filter((event) => event.type === 'action_started' && event.payload.provenanceKind === 'llm');
  const successfulDecisionIds = new Set(world.llmLedger.filter((entry) => entry.status === 'ok').map((entry) => entry.llmRequestId));
  const linkedActions = actions.filter((event) => typeof event.payload.llmRequestId === 'string' && successfulDecisionIds.has(event.payload.llmRequestId)).length;
  const inputTokens = world.llmLedger.reduce((sum, entry) => sum + entry.tokenUsage.input, 0);
  const outputTokens = world.llmLedger.reduce((sum, entry) => sum + entry.tokenUsage.output, 0);
  const cachedTokens = world.llmLedger.reduce((sum, entry) => sum + entry.tokenUsage.cached, 0);
  return {
    runId,
    seed,
    status: world.status,
    endedReason: world.endedReason,
    gameTime: world.gameTime,
    wallSeconds: round(wallSeconds, 1),
    aliveAtEnd: Object.values(world.agents).filter((agent) => agent.isAlive).length,
    firstDayDeaths: deaths.filter((death) => death.gameTime < WORLD_START_TIME + 1440).length,
    aliveAtDay3: 3 - deaths.filter((death) => death.gameTime <= WORLD_START_TIME + 2 * 1440).length,
    conversationsAtLeastTwoTurns: conversations.filter((conversation) => conversation.turns.length >= 2).length,
    maxConversationTurns: Math.max(0, ...conversations.map((conversation) => conversation.turns.length)),
    bilateralSocialEvents: bilateralFacts + bilateralEvents + bilateralApproaches,
    messageCount: messages.length,
    repetitionIncidents: world.repetitionIncidents.length,
    repetitionRatio: round(world.repetitionIncidents.length / Math.max(1, messages.length), 4),
    causalChains: chains.length,
    persistentPlansWithTwoSteps: [...planCompletions.values()].filter((count) => count >= 2).length,
    llmCalls: world.llmLedger.length,
    llmStatuses: statusCounts(world.llmLedger),
    providers: [...new Set(world.llmLedger.map((entry) => entry.provider))],
    models: [...new Set(world.llmLedger.map((entry) => entry.model))],
    behaviorActions: actions.length,
    actionsWithProvenance: linkedActions,
    provenanceCoverage: round(linkedActions / Math.max(1, actions.length), 4),
    inputTokens,
    outputTokens,
    cachedTokens,
    deaths,
    unexplainedDeaths: deaths.filter((death) => !['dehydration', 'starvation', 'exhaustion', 'health_collapse'].includes(death.cause)).length,
  };
}

function exportWorld(world: Mvp2World): Record<string, unknown> {
  const agents = Object.fromEntries(Object.values(world.agents).map((agent) => {
    const { cognitive, ...state } = agent;
    return [agent.id, {
      ...state,
      cognitive: {
        exploredCells: cognitive.explored.reduce((sum, value) => sum + (value ? 1 : 0), 0),
        visibleCells: cognitive.visible.reduce((sum, value) => sum + (value ? 1 : 0), 0),
        landmarks: cognitive.landmarks,
        positionEstimate: cognitive.positionEstimate,
      },
    }];
  }));
  const conservationSummary: Record<string, number> = {};
  for (const entry of world.conservationLedger) conservationSummary[`${entry.kind}:${entry.note}`] = round((conservationSummary[`${entry.kind}:${entry.note}`] ?? 0) + entry.delta, 4);
  return {
    worldId: world.worldId,
    seed: world.seed,
    gameTime: world.gameTime,
    status: world.status,
    endedReason: world.endedReason,
    map: { version: world.map.data.version, width: world.map.width, height: world.map.height, designVersion: 'small-island-deep-agents-v1' },
    agents,
    resources: world.resources,
    wrecks: world.wrecks,
    groundItems: world.groundItems,
    fires: world.fires,
    events: world.events,
    conversations: world.conversations,
    socialFacts: world.socialFacts,
    relationshipEvidence: world.relationshipEvidence,
    repetitionIncidents: world.repetitionIncidents,
    llmLedger: world.llmLedger,
    conservationSummary,
  };
}

function bundlePath(index: number): string {
  return path.join(outputDir, `run-${String(index + 1).padStart(2, '0')}-bundle.json`);
}

function readCompleted(index: number): RunBundle | null {
  const file = bundlePath(index);
  if (!fs.existsSync(file)) return null;
  try {
    const bundle = JSON.parse(fs.readFileSync(file, 'utf8')) as RunBundle;
    if (bundle.schema !== 'aisland.phase31.real_api_run_bundle.v1' || bundle.summary.status !== 'ended') return null;
    // Summary definitions can be tightened without spending another real-API
    // run: always derive them again from the immutable structured world
    // evidence, then persist the refreshed summary back into the bundle.
    bundle.summary = buildSummary(bundle.world as unknown as Mvp2World, bundle.identity.runId, bundle.identity.seed, bundle.summary.wallSeconds, bundle.causalChains);
    fs.writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);
    return bundle;
  } catch {
    return null;
  }
}

async function runOne(index: number): Promise<RunBundle> {
  const completed = readCompleted(index);
  if (completed) {
    console.log(`[phase31-real] ${completed.summary.runId} resume: existing completed bundle`);
    return completed;
  }
  const seed = seeds[index];
  const runId = `phase31_real_${String(index + 1).padStart(2, '0')}`;
  const world = createMvp2World(runId, seed, RuntimeMap.loadDefault());
  const brain = makeBrain(seed);
  const dailySnapshots: DailySnapshot[] = [snapshot(world, 1)];
  let nextSnapshotAt = WORLD_START_TIME + 1440;
  let previousLight: string = lightPhaseAt(world.gameTime);
  const started = Date.now();
  const deadline = started + 45 * 60_000;
  while (world.status === 'running') {
    if (Date.now() > deadline) throw new Error(`${runId} exceeded 45 minute wall timeout at gameTime=${world.gameTime}`);
    previousLight = stepWorldMovement(world, stepMinutes);
    await decideAgents(world, brain, previousLight);
    while (world.gameTime >= nextSnapshotAt && dailySnapshots.length < 8) {
      const day = dailySnapshots.length + 1;
      dailySnapshots.push(snapshot(world, day));
      console.log(`[phase31-real] ${runId} day=${day} alive=${dailySnapshots.at(-1)?.alive} calls=${world.llmLedger.length}`);
      nextSnapshotAt += 1440;
    }
  }
  if (dailySnapshots.at(-1)?.gameTime !== world.gameTime) dailySnapshots.push(snapshot(world, Math.min(8, Math.floor((world.gameTime - WORLD_START_TIME) / 1440) + 1)));
  const chains = extractCausalChains(world);
  const summary = buildSummary(world, runId, seed, (Date.now() - started) / 1000, chains);
  const bundle: RunBundle = {
    schema: 'aisland.phase31.real_api_run_bundle.v1',
    identity: {
      runId,
      seed,
      provider: process.env.LLM_PROVIDER ?? 'deepseek',
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      mode: 'real',
      mapVersion: world.map.data.version,
    },
    dailySnapshots,
    causalChains: chains,
    summary,
    world: exportWorld(world),
  };
  fs.writeFileSync(bundlePath(index), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`[phase31-real] ${runId} complete wall=${summary.wallSeconds}s alive=${summary.aliveAtEnd} calls=${summary.llmCalls} conv2=${summary.conversationsAtLeastTwoTurns} causal=${summary.causalChains} repeat=${(summary.repetitionRatio * 100).toFixed(1)}%`);
  return bundle;
}

function audit(bundles: RunBundle[]): { passed: boolean; gates: Record<string, { passed: boolean; detail: string }>; runSummaries: RunSummary[] } {
  const summaries = bundles.map((bundle) => bundle.summary);
  const provenanceByBundle = bundles.map((bundle) => {
    const world = bundle.world as { llmLedger?: LlmProvenance[]; events?: WorldEvent[] };
    const ledger = world.llmLedger ?? [];
    const events = world.events ?? [];
    const successfulRequests = new Set(ledger.filter((entry) => entry.status === 'ok').map((entry) => entry.llmRequestId));
    const behaviorActions = events.filter((event) => event.type === 'action_started' && event.payload.provenanceKind === 'llm');
    const linked = behaviorActions.filter((event) => typeof event.payload.llmRequestId === 'string' && successfulRequests.has(event.payload.llmRequestId)).length;
    return {
      ledger,
      coverage: round(linked / Math.max(1, behaviorActions.length), 4),
      providerClean: ledger.length > 0 && ledger.every((entry) => entry.provider === bundle.identity.provider && !['mock', 'replay'].includes(entry.provider)),
      modelClean: ledger.length > 0 && ledger.every((entry) => entry.model === bundle.identity.model),
    };
  });
  const allReal = bundles.length === 6 && bundles.every((bundle, index) => bundle.identity.mode === 'real'
    && provenanceByBundle[index].ledger.length === bundle.summary.llmCalls
    && provenanceByBundle[index].providerClean
    && provenanceByBundle[index].modelClean
    && provenanceByBundle[index].coverage === 1);
  const noDayOneDeaths = summaries.every((summary) => summary.firstDayDeaths === 0);
  const dayThreeSurvival = summaries.filter((summary) => summary.aliveAtDay3 >= 2).length;
  const conversationRuns = summaries.filter((summary) => summary.conversationsAtLeastTwoTurns > 0).length;
  const causalRuns = summaries.filter((summary) => summary.causalChains > 0).length;
  const totalMessages = summaries.reduce((sum, summary) => sum + summary.messageCount, 0);
  const totalRepetitions = summaries.reduce((sum, summary) => sum + summary.repetitionIncidents, 0);
  const repetitionRatio = totalRepetitions / Math.max(1, totalMessages);
  const bilateralRuns = summaries.filter((summary) => summary.bilateralSocialEvents > 0).length;
  const explainedDeaths = summaries.every((summary) => summary.unexplainedDeaths === 0);
  const completed = summaries.every((summary) => summary.status === 'ended' && (summary.gameTime >= WORLD_END_TIME || summary.aliveAtEnd === 0));
  const gates = {
    'REAL-01': { passed: allReal, detail: `real bundles=${bundles.length}/6; recomputedProvenance=${provenanceByBundle.map((entry) => entry.coverage).join(',')}` },
    'REAL-02': { passed: noDayOneDeaths, detail: `firstDayDeaths=${summaries.map((summary) => summary.firstDayDeaths).join(',')}` },
    'REAL-03': { passed: dayThreeSurvival >= 5, detail: `runsWith2AliveAtDay3=${dayThreeSurvival}/6` },
    'REAL-04': { passed: conversationRuns >= 4, detail: `runsWith2TurnConversation=${conversationRuns}/6` },
    'REAL-05': { passed: causalRuns >= 4, detail: `runsWithCausalChain=${causalRuns}/6` },
    'REAL-06': { passed: repetitionRatio < 0.1, detail: `repetition=${totalRepetitions}/${totalMessages} (${(repetitionRatio * 100).toFixed(2)}%)` },
    'REAL-07': { passed: bilateralRuns >= 3, detail: `runsWithBilateralEvent=${bilateralRuns}/6` },
    'REAL-08': { passed: explainedDeaths && completed, detail: `completed=${completed}; unexplainedDeaths=${summaries.reduce((sum, summary) => sum + summary.unexplainedDeaths, 0)}` },
  };
  return { passed: Object.values(gates).every((gate) => gate.passed), gates, runSummaries: summaries };
}

async function pool(count: number, workers: number): Promise<RunBundle[]> {
  const results = new Array<RunBundle>(count);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < count) {
      const index = cursor++;
      results[index] = await runOne(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, count) }, () => worker()));
  return results;
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  if (!process.env.LLM_API_KEY && !auditOnly) throw new Error('LLM_API_KEY is required for Phase 3.1 real API acceptance');
  let bundles: RunBundle[];
  if (auditOnly) {
    bundles = seeds.map((_, index) => readCompleted(index)).filter((bundle): bundle is RunBundle => bundle !== null);
  } else {
    console.log(`[phase31-real] starting ${requestedRuns} real worlds, concurrency=${concurrency}, provider=${process.env.LLM_PROVIDER ?? 'deepseek'}, model=${process.env.LLM_MODEL ?? 'deepseek-v4-flash'}`);
    bundles = await pool(requestedRuns, concurrency);
  }
  const result = audit(bundles);
  const report = {
    schema: 'aisland.phase31.real_api_batch_report.v1',
    generatedAt: new Date().toISOString(),
    provider: process.env.LLM_PROVIDER ?? 'deepseek',
    model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
    requestedRuns: auditOnly ? 6 : requestedRuns,
    completedBundles: bundles.length,
    passed: result.passed,
    gates: result.gates,
    aggregate: {
      llmCalls: result.runSummaries.reduce((sum, summary) => sum + summary.llmCalls, 0),
      inputTokens: result.runSummaries.reduce((sum, summary) => sum + summary.inputTokens, 0),
      outputTokens: result.runSummaries.reduce((sum, summary) => sum + summary.outputTokens, 0),
      cachedTokens: result.runSummaries.reduce((sum, summary) => sum + summary.cachedTokens, 0),
      wallSeconds: round(result.runSummaries.reduce((sum, summary) => sum + summary.wallSeconds, 0), 1),
    },
    runs: result.runSummaries,
  };
  fs.writeFileSync(path.join(outputDir, 'batch-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const [id, gateResult] of Object.entries(result.gates)) console.log(`[phase31-real] ${id} ${gateResult.passed ? 'PASS' : 'FAIL'} ${gateResult.detail}`);
  console.log(`[phase31-real] report=${path.join(outputDir, 'batch-report.json')}`);
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[phase31-real] fatal', error);
  process.exit(1);
});
