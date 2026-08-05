// Authoritative simulation loop (PRD 4.2, 18.2, WORLD-001..005).
// Discrete decisions over continuous presentation; decision batches freeze
// world logic while LLM calls run so API latency never decides resource races.

import { LlmAdapter, type LlmCallResult } from '../llm/adapter';
import { generateDialogue } from '../llm/dialogue';
import { planAction } from '../llm/planner';
import { computeMetrics } from './metrics';
import { getProfile, compileMechanics } from './profile';
import { formatGameTime, MINUTES_PER_DAY } from './scenario';
import {
  adjudicatePromises,
  applyDailyRegen,
  applySpeechActState,
  applySurvivalTick,
  buildAvailableActions,
  clamp,
  endConversation,
  gameMasterValidate,
  interruptAction,
  resetEventCounter,
  settleAction,
  startAction,
  startConversation,
  addMessage,
  emitEvent,
  computeWaste,
  createPromise,
  type NeedChange,
} from './systems';
import type { ActionIntent, FinalStats, WorldEvent, WorldState } from './types';

const DECISION_INTERVAL = 30; // island minutes
const SURVIVAL_INTERVAL = 10;
const TICK_MS = 250;

type PendingTalk = {
  conversationId: string;
  initiatorIntent: string;
};

export class SimulationEngine {
  world: WorldState;
  adapter: LlmAdapter;
  onStateChange: ((world: WorldState) => void) | null = null;
  onEnded: ((world: WorldState) => void) | null = null;

  private timer: NodeJS.Timeout | null = null;
  private lastTickWallMs = 0;
  private survivalAccum = 0;
  private decisionAccum = 0;
  private pendingDecisionIds: string[] = [];
  private pendingTalks: PendingTalk[] = [];
  private triggers: Array<{ agentId: string; reason: string }> = [];
  private totalFrozenMs = 0;
  private totalWallMs = 0;
  private freezeStartMs: number | null = null;
  private finalized = false;

  constructor(world: WorldState, adapter: LlmAdapter) {
    this.world = world;
    this.adapter = adapter;
  }

  start(): void {
    if (this.timer) return;
    resetEventCounter();
    this.world.status = 'running';
    this.world.gameTime = 0;
    this.lastTickWallMs = Date.now();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    emitEvent(this.world, 'world_started', {
      payload: {
        fixture: this.world.scenario.fixture,
        seed: this.world.scenario.seed,
        promptVersion: this.world.scenario.promptVersion,
        model: this.world.scenario.llm.model,
      },
      salience: 3,
      observers: 'all',
    });
    this.onStateChange?.(this.world);
  }

  pause(): void {
    if (this.world.status === 'running') this.world.status = 'paused';
  }

  resume(): void {
    if (this.world.status === 'paused') {
      this.world.status = 'running';
      this.lastTickWallMs = Date.now();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.world.status === 'running') this.world.status = 'paused';
  }

  get frozen(): boolean {
    return this.world.decisionFreeze;
  }

  private async tick(): Promise<void> {
    const world = this.world;
    if (world.status !== 'running' || this.finalized) return;
    const now = Date.now();
    const dtRealMs = now - this.lastTickWallMs;
    this.lastTickWallMs = now;

    if (world.decisionFreeze) {
      // World logic paused; keep animations (positions unchanged).
      this.totalFrozenMs += dtRealMs;
      this.onStateChange?.(world);
      return;
    }
    this.totalWallMs += dtRealMs;

    const realSecPerIslandMin = world.scenario.realSecondsPerIslandMinute / world.scenario.timeScale;
    const dtIsland = Math.min(60, dtRealMs / 1000 / realSecPerIslandMin);
    world.gameTime += dtIsland;

    // Daily regen at 06:00.
    const prevDayStart = world.gameTime - dtIsland < dayStartAt(world.gameTime);
    if (world.gameTime >= dayStartAt(world.gameTime) && prevDayStart) {
      applyDailyRegen(world);
    }

    // Survival ticks.
    this.survivalAccum += dtIsland;
    while (this.survivalAccum >= SURVIVAL_INTERVAL) {
      this.survivalAccum -= SURVIVAL_INTERVAL;
      const changes = applySurvivalTick(world, SURVIVAL_INTERVAL);
      for (const c of changes) this.handleNeedChange(c);
    }

    // Action progress.
    await this.progressActions(dtIsland);

    // Conversations needing dialogue generation.
    if (this.pendingTalks.length > 0) {
      await this.processTalks();
    }

    // Promise adjudication at deadlines.
    adjudicatePromises(world, world.gameTime);

    // Decision scheduling.
    this.decisionAccum += dtIsland;
    if (this.decisionAccum >= DECISION_INTERVAL || this.triggers.length > 0) {
      this.decisionAccum = 0;
      await this.maybeRunDecisionBatch();
    }

    // End conditions.
    if (this.checkEndConditions()) {
      this.finalize();
    }

    world.worldVersion += 1;
    this.onStateChange?.(world);
  }

  private async progressActions(dtIsland: number): Promise<void> {
    const world = this.world;
    for (const agent of Object.values(world.agents)) {
      if (!agent.isAlive || !agent.currentAction) continue;
      const inst = agent.currentAction;
      if (inst.action.type === 'move' && inst.path && inst.path.length > 1) {
        const mech = compileMechanics(getProfile(agent.profileId));
        const load = agent.inventory.water + agent.inventory.food;
        const speed = mech.speedTilesPerMin * (1 / (1 + 0.04 * load)) * (agent.needs.stamina < 20 ? 0.6 : 1);
        let remaining = dtIsland * speed;
        let idx = currentPathIndex(agent, inst.path);
        while (remaining > 0 && idx < inst.path.length - 1) {
          const next = inst.path[idx + 1];
          const cost = world.map.moveCost[next.y][next.x];
          if (remaining >= cost) {
            remaining -= cost;
            idx += 1;
            agent.position = { ...inst.path[idx] };
            agent.facing = {
              x: Math.sign(inst.path[idx].x - inst.path[Math.max(0, idx - 1)].x) || 1,
              y: Math.sign(inst.path[idx].y - inst.path[Math.max(0, idx - 1)].y),
            };
          } else {
            // partial step: interpolate position (visual only; grid position unchanged)
            const t = remaining / cost;
            agent.position = {
              x: agent.position.x + (next.x - agent.position.x) * t,
              y: agent.position.y + (next.y - agent.position.y) * t,
            };
            remaining = 0;
          }
        }
        if (idx >= inst.path.length - 1) {
          agent.position = { ...inst.path[inst.path.length - 1] };
          settleAction(world, agent);
          this.afterAction(agent.id);
        }
      } else if (world.gameTime >= inst.endsAt) {
        if (inst.action.type === 'talk') {
          // Conversation begins at settlement; dialogue generated next.
          const conv = startConversation(
            world,
            agent.id,
            (inst.action as { targetId: string }).targetId,
            undefined,
            inst.endsAt - inst.startedAt,
          );
          this.pendingTalks.push({
            conversationId: conv.conversationId,
            initiatorIntent: inst.publicIntent,
          });
          inst.status = 'completed';
          agent.currentAction = undefined;
          this.afterAction(agent.id);
        } else {
          settleAction(world, agent);
          this.afterAction(agent.id);
        }
      }
    }
  }

  private afterAction(agentId: string) {
    const agent = this.world.agents[agentId];
    if (!agent || !agent.isAlive) return;
    // The agent becomes idle; the next 30-island-minute decision check will
    // schedule a new plan (PRD 4.2: decision check every 30 min + event triggers).
    // No immediate replan, no trigger storm.
  }

  private handleNeedChange(c: NeedChange) {
    const agent = this.world.agents[c.agentId];
    if (!agent || !agent.isAlive) return;
    // Interrupt low-priority actions when in danger.
    const action = agent.currentAction;
    if (action && c.reason !== 'died' && c.reason !== 'action_done') {
      const isUrgent = action.action.type === 'rest' || action.action.type === 'talk' || action.action.type === 'explore';
      if (isUrgent && (agent.needs.water < 20 || agent.needs.food < 20 || agent.needs.health < 25)) {
        interruptAction(this.world, agent, c.reason);
      }
    }
    if (c.reason !== 'died') this.triggers.push({ agentId: c.agentId, reason: c.reason });
  }

  private async processTalks(): Promise<void> {
    const world = this.world;
    while (this.pendingTalks.length > 0) {
      const job = this.pendingTalks.shift()!;
      const conv = world.conversations[job.conversationId];
      if (!conv) continue;
      const [initiatorId, responderId] = conv.participants;
      const initiator = world.agents[initiatorId];
      const responder = world.agents[responderId];
      if (!initiator?.isAlive && !responder?.isAlive) {
        endConversation(world, conv.conversationId);
        continue;
      }

      world.decisionFreeze = true;
      this.freezeStartMs = Date.now();
      let result;
      try {
        result = await generateDialogue(world, conv, job.initiatorIntent, this.adapter, `req_${conv.conversationId}`);
      } catch (err) {
        console.error('[island] dialogue error', err);
        result = { output: null, results: [] as LlmCallResult[] };
      } finally {
        world.decisionFreeze = false;
        this.totalFrozenMs += Date.now() - (this.freezeStartMs ?? Date.now());
        this.freezeStartMs = null;
      }

      if (result.output) {
        const out = result.output;
        addMessage(world, conv.conversationId, initiatorId, out.initiatorMessage);
        applySpeechActState(world, initiatorId, responderId, out.initiatorMessage, lastMessageEventId(world, conv.conversationId));
        for (const m of out.responderMessages) {
          if (!responder?.isAlive) break;
          addMessage(world, conv.conversationId, responderId, m);
          applySpeechActState(world, responderId, initiatorId, m, lastMessageEventId(world, conv.conversationId));
        }
        // Acceptance of a request creates a promise from the acceptor (SOC-002).
        this.applyAcceptancePromises(world, conv.conversationId);
      }
      endConversation(world, conv.conversationId);
      this.recordLlm(world, initiatorId, 'dialogue', result.results);
      if (result.results.length > 1) {
        this.recordLlm(world, initiatorId, 'repair', result.results.slice(1));
      }
    }
  }

  private applyAcceptancePromises(world: WorldState, conversationId: string) {
    const conv = world.conversations[conversationId];
    if (!conv) return;
    const [_a, _b] = conv.participants;
    for (const m of conv.messages) {
      if (m.speechAct.type !== 'request_resource' || !m.speechAct.resource) continue;
      const acceptor = conv.messages.find(
        (x) =>
          x.speakerId !== m.speakerId &&
          x.speechAct.type === 'accept_request' &&
          x.speechAct.resource === m.speechAct.resource &&
          x.gameTime >= m.gameTime,
      );
      if (!acceptor) continue;
      const exists = world.promiseLedger.some(
        (p) =>
          p.promiserId === acceptor.speakerId &&
          p.recipientId === m.speakerId &&
          p.actionType === 'give' &&
          p.resource === m.speechAct.resource &&
          p.status === 'pending',
      );
      if (!exists) {
        createPromise(
          world,
          acceptor.speakerId,
          m.speakerId,
          'give',
          m.speechAct.resource,
          m.speechAct.amount ?? 1,
          world.gameTime + 8 * 60,
          lastMessageEventId(world, conversationId),
        );
      }
    }
  }

  private async maybeRunDecisionBatch(): Promise<void> {
    const world = this.world;
    if (world.decisionFreeze) return;
    const due: string[] = [];
    const triggeredIds = new Set(this.triggers.map((t) => t.agentId));
    this.triggers = [];
    for (const agent of Object.values(world.agents)) {
      if (!agent.isAlive || agent.currentAction) continue;
      const intervalPassed = world.gameTime - agent.lastDecisionTime >= DECISION_INTERVAL;
      const forced = agent.lastDecisionTime < 0; // never decided yet or just finished
      const triggerFresh = triggeredIds.has(agent.id) && world.gameTime - agent.lastDecisionTime >= 10;
      if (intervalPassed || forced || triggerFresh) {
        due.push(agent.id);
      }
    }
    if (due.length === 0) return;

    world.decisionFreeze = true;
    this.freezeStartMs = Date.now();
    const snapshotVersion = world.worldVersion;
    const requestedGameTime = world.gameTime;
    const batchId = `batch_${world.worldVersion}_${Math.floor(requestedGameTime)}`;

    let results: Array<{ agentId: string; intent: Awaited<ReturnType<typeof planAction>>['intent']; record: LlmCallResult; attempts: LlmCallResult[] }> = [];
    try {
      results = await Promise.all(
        due.map((agentId) =>
          planAction(world, agentId, this.adapter, `${batchId}_${agentId}`).then((r) => ({ agentId, ...r })),
        ),
      );
    } catch (err) {
      console.error('[island] planner batch error', err);
      for (const agentId of due) {
        results.push({
          agentId,
          intent: null,
          record: { content: null, status: 'error', latencyMs: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, model: world.scenario.llm.model },
          attempts: [],
        });
      }
    } finally {
      world.decisionFreeze = false;
      this.totalFrozenMs += Date.now() - (this.freezeStartMs ?? Date.now());
      this.freezeStartMs = null;
    }

    for (const result of results) {
      const agent = world.agents[result.agentId];
      if (!agent || !agent.isAlive) continue;
      agent.decisionCount += 1;
      agent.lastDecisionTime = requestedGameTime;
      this.recordLlm(world, result.agentId, 'planner', result.attempts);
      if (result.attempts.length > 1) {
        this.recordLlm(world, result.agentId, 'repair', result.attempts.slice(1));
      }

      let intent: ActionIntent | null = result.intent;
      let validation = intent ? gameMasterValidate(world, intent) : { ok: false as const, reason: 'no_intent', detail: '模型未返回可用意图' };
      let fallbackUsed = false;
      if (!validation.ok) {
        // Try fallback.
        if (intent?.fallback) {
          const fallbackIntent = { ...intent, action: intent.fallback, requestId: `${intent.requestId}_fb` };
          const fbValidation = gameMasterValidate(world, fallbackIntent);
          if (fbValidation.ok) {
            validation = fbValidation;
            intent = fallbackIntent;
            fallbackUsed = true;
          }
        }
      }
      if (!validation.ok) {
        agent.invalidActionStreak += 1;
        agent.lastInvalidAction = `${intent?.action.type ?? 'none'} -> ${validation.reason}`;
        // Safe fallback: rest.
        const restIntent: ActionIntent = {
          requestId: `${batchId}_${agent.id}_safe`,
          actorId: agent.id,
          snapshotVersion,
          requestedGameTime,
          action: { type: 'rest', durationMinutes: 60 },
          publicIntent: '我调整一下状态再行动。',
          privateMotive: '当前计划不可行，先休息并重新评估。',
        };
        const restValidation = gameMasterValidate(world, restIntent);
        if (restValidation.ok) {
          startAction(world, agent, restIntent, restValidation.validated, `${batchId}_${agent.id}_op`);
        }
        agent.planDebug = {
          requestedGameTime,
          rawOutput: result.record.content ?? undefined,
          validationResult: `${validation.reason}: ${validation.detail}`,
          fallbackUsed,
          latencyMs: result.record.latencyMs,
        };
        if (agent.invalidActionStreak >= 3) {
          emitEvent(world, 'diagnostic_alert', {
            actorId: agent.id,
            payload: { reason: 'repeated_invalid_actions', detail: agent.lastInvalidAction },
            salience: 8,
            observers: 'all',
          });
        }
        continue;
      }

      agent.invalidActionStreak = 0;
      startAction(world, agent, intent!, validation.validated, `${batchId}_${agent.id}_op`);
      agent.planDebug = {
        requestedGameTime,
        rawOutput: result.record.content ?? undefined,
        validationResult: 'ok',
        fallbackUsed,
        latencyMs: result.record.latencyMs,
      };
      emitEvent(world, 'action_started', {
        actorId: agent.id,
        locationId: intent!.action.type === 'move' ? (intent!.action as { targetId: string }).targetId : undefined,
        payload: {
          actionType: intent!.action.type,
          publicIntent: intent!.publicIntent,
          privateMotive: intent!.privateMotive,
          endsAt: validation.validated.endTime,
          availableActionCount: buildAvailableActions(world, agent).length,
        },
        salience: 3,
        observers: [agent.id, ...resolveNearby(world, agent.id)],
        sourceOperationId: `${batchId}_${agent.id}_op`,
      });
    }
    world.decisionFreeze = false;
  }

  private recordLlm(world: WorldState, agentId: string, kind: 'planner' | 'dialogue' | 'repair' | 'summary', results: LlmCallResult[]) {
    const cfg = world.scenario.llm;
    for (const r of results) {
      world.llmUsage.calls.push({
        requestId: `req_${world.worldVersion}_${agentId}_${world.llmUsage.calls.length}`,
        kind,
        agentId,
        worldVersion: world.worldVersion,
        promptVersion: world.scenario.promptVersion,
        latencyMs: r.latencyMs,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        cachedTokens: r.cachedTokens,
        status: r.status,
        model: r.model,
        estimatedCostUsd: estimateCost(cfg.model, r.promptTokens, r.completionTokens, r.cachedTokens),
      });
    }
    this.refreshUsageSummary(world);
  }

  private refreshUsageSummary(world: WorldState) {
    const calls = world.llmUsage.calls;
    const planner = calls.filter((c) => c.kind === 'planner').length;
    const dialogue = calls.filter((c) => c.kind === 'dialogue').length;
    const repair = calls.filter((c) => c.kind === 'repair').length;
    const latencies = calls.map((c) => c.latencyMs).sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;
    world.llmUsage.summary = {
      plannerCalls: planner,
      dialogueCalls: dialogue,
      repairCalls: repair,
      totalPromptTokens: calls.reduce((s, c) => s + c.promptTokens, 0),
      totalCompletionTokens: calls.reduce((s, c) => s + c.completionTokens, 0),
      totalCachedTokens: calls.reduce((s, c) => s + c.cachedTokens, 0),
      totalCostUsd: Math.round(calls.reduce((s, c) => s + c.estimatedCostUsd, 0) * 100000) / 100000,
      p95LatencyMs: p95,
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length) : 0,
    };
  }

  private checkEndConditions(): boolean {
    const world = this.world;
    if (world.gameTime >= world.scenario.durationMinutes) {
      return true;
    }
    const alive = Object.values(world.agents).filter((a) => a.isAlive);
    if (alive.length === 0) return true;
    // Water apocalypse: no water anywhere and everyone in irreversible dehydration.
    if (world.gameTime >= 3 * MINUTES_PER_DAY) {
      const totalWater =
        Object.values(world.resources).reduce((s, n) => s + (n.resource === 'water' ? n.stock : 0), 0) +
        Object.values(world.containers).reduce((s, c) => s + c.inventory.water, 0) +
        alive.reduce((s, a) => s + a.inventory.water, 0);
      if (totalWater === 0 && alive.every((a) => a.needs.water <= 5)) return true;
    }
    return false;
  }

  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    const world = this.world;
    const endReason =
      world.gameTime >= world.scenario.durationMinutes
        ? '第5日18:00，观察窗口结束'
        : Object.values(world.agents).every((a) => !a.isAlive)
          ? '所有角色死亡'
          : '水资源彻底枯竭';
    // Force end of pending actions/events.
    computeWaste(world);
    const metrics = computeMetrics(world);
    metrics.llmWaitFraction = this.totalWallMs > 0 ? Math.round((this.totalFrozenMs / this.totalWallMs) * 1000) / 1000 : 0;
    world.finalStats = buildFinalStats(world, metrics, endReason);
    world.status = 'ended';
    emitEvent(world, 'world_ended', {
      payload: { reason: endReason, gameTime: formatGameTime(world.gameTime) },
      salience: 10,
      observers: 'all',
    });
    this.stop();
    this.onEnded?.(world);
    this.onStateChange?.(world);
  }
}

function buildFinalStats(world: WorldState, metrics: FinalStats['metrics'], endReason: string): FinalStats {
  const perAgent: FinalStats['perAgent'] = {};
  for (const agent of Object.values(world.agents)) {
    perAgent[agent.id] = {
      alive: agent.isAlive,
      finalHealth: Math.round(agent.needs.health),
      harvested: { ...agent.stats.harvested },
      consumed: { ...agent.stats.consumed },
      given: { ...agent.stats.given },
      received: { ...agent.stats.received },
      stored: { ...agent.stats.storedToPublic },
      taken: { ...agent.stats.takenFromPublic },
      wasted: { ...agent.stats.wasted },
      refusals: agent.stats.refusalsMade,
      fulfilled: agent.stats.promisesFulfilled,
      broken: agent.stats.promisesBroken,
      locationsDiscovered: agent.knownLocations.filter((l) => l !== 'crash_camp'),
      locationsShared: agent.stats.locationsShared,
    };
  }
  const timeline = [...world.events]
    .filter((e) => e.salience >= 6 || e.type === 'world_started' || e.type === 'world_ended')
    .sort((a, b) => a.gameTime - b.gameTime)
    .slice(-14)
    .map((e) => ({ gameTime: e.gameTime, text: shortEventText(world, e), eventId: e.eventId }));
  return {
    endedAt: world.gameTime,
    endReason,
    survivors: Object.values(world.agents).filter((a) => a.isAlive).map((a) => a.id),
    deaths: world.events
      .filter((e) => e.type === 'agent_died')
      .map((e) => ({ agentId: e.actorId!, gameTime: e.gameTime, cause: String(e.payload?.cause ?? '未知') })),
    perAgent,
    metrics,
    timeline,
  };
}

function shortEventText(world: WorldState, e: WorldEvent): string {
  const actor = e.actorId ? world.agents[e.actorId]?.name ?? e.actorId : '';
  const target = e.targetId ? world.agents[e.targetId]?.name ?? e.targetId : '';
  switch (e.type) {
    case 'world_started': return '三人从坠机点醒来，开始五天的荒岛求生。';
    case 'world_ended': return String(e.payload?.reason);
    case 'resource_given': return `${actor} 给了 ${target} ${e.payload?.amount} 份${e.payload?.resource === 'water' ? '水' : '食物'}。`;
    case 'promise_fulfilled': return `${actor} 兑现了对 ${target} 的承诺。`;
    case 'promise_broken': return `${actor} 违背了对 ${target} 的承诺。`;
    case 'promise_impossible': return `${actor} 的承诺因客观原因无法履行。`;
    case 'location_shared': return `${actor} 把地点信息告诉了 ${target}。`;
    case 'agent_died': return `${actor} 死亡（${e.payload?.cause}）。`;
    case 'backpack_looted': return `${actor} 拾取了 ${target} 的背包。`;
    case 'action_started':
      return `${actor}：${e.payload?.publicIntent}`;
    case 'message_spoken':
      return `${actor} 对 ${target} 说：“${e.payload?.text}”`;
    case 'location_discovered':
      return `${actor} 发现了 ${world.map.locations.find((l) => l.id === e.locationId)?.name ?? e.locationId}。`;
    default:
      return e.type;
  }
}

function currentPathIndex(agent: { position: { x: number; y: number } }, path: Array<{ x: number; y: number }>): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.abs(path[i].x - agent.position.x) + Math.abs(path[i].y - agent.position.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function dayStartAt(gameTime: number): number {
  return Math.floor(gameTime / MINUTES_PER_DAY) * MINUTES_PER_DAY;
}

function resolveNearby(world: WorldState, agentId: string): string[] {
  const a = world.agents[agentId];
  if (!a) return [];
  return Object.values(world.agents)
    .filter((o) => o.id !== agentId && o.isAlive && Math.abs(o.position.x - a.position.x) + Math.abs(o.position.y - a.position.y) <= 7)
    .map((o) => o.id);
}

function lastMessageEventId(world: WorldState, conversationId: string): string {
  for (let i = world.events.length - 1; i >= 0; i--) {
    const e = world.events[i];
    if (e.type === 'message_spoken' && e.payload?.conversationId === conversationId) return e.eventId;
  }
  return `evt_${world.events.length}`;
}

function estimateCost(model: string, promptTokens: number, completionTokens: number, cachedTokens: number): number {
  // DeepSeek-style pricing (USD per 1M tokens); used only for reporting.
  const isPro = model.includes('pro');
  const inputRate = isPro ? 2.0 : 0.27;
  const outputRate = isPro ? 8.0 : 1.1;
  const cacheReadRate = inputRate * 0.1;
  const uncached = Math.max(0, promptTokens - cachedTokens);
  return (uncached * inputRate + cachedTokens * cacheReadRate + completionTokens * outputRate) / 1_000_000;
}

export { clamp };
