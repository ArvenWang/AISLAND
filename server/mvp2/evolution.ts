import { getProfile } from '../engine/profile';
import type {
  ActionInstance,
  ActionType,
  AgentPlan,
  AgentState,
  ConversationTurn,
  EpisodicMemory,
  Mvp2World,
  OfferFact,
  PlanStep,
  RelationshipEvidence,
  SocialFact,
  WorldEvent,
} from './types';

type Mvp2SpeechAct = ConversationTurn['speechActType'];

const IMPORTANT_EVENT_TYPES = new Set([
  'resource_discovered', 'wreck_searched', 'handover_completed', 'handover_refused',
  'item_taken_owned', 'promise_created', 'promise_kept', 'promise_broken',
  'agent_died', 'fire_lit', 'plan_step_completed',
  'plan_replanned', 'encounter_started',
]);

function summaryOf(world: Mvp2World, event: WorldEvent): string {
  const actor = event.actorId ? world.agents[event.actorId]?.name ?? event.actorId : '环境';
  const target = event.targetId ? world.agents[event.targetId]?.name ?? event.targetId : '';
  switch (event.type) {
    case 'resource_discovered': return `${actor}亲眼发现了${String(event.payload.kind ?? '资源')}。`;
    case 'handover_completed': return `${actor}把${String(event.payload.kind ?? '物品')}交给了${target}。`;
    case 'handover_refused': return `${target}拒绝了${actor}的递交。`;
    case 'item_taken_owned': return `${actor}拿走了有他人主张的${String(event.payload.kind ?? '物品')}。`;
    case 'message_spoken': return `${actor}对${target}说：“${String(event.payload.text ?? '').slice(0, 80)}”`;
    case 'wreck_searched': return `${actor}搜索了事故主残骸。`;
    case 'agent_died': return `${actor}死亡。`;
    case 'fire_lit': return `${actor}成功生起了火。`;
    case 'plan_step_completed': return `${actor}完成计划步骤：${String(event.payload.intent ?? '')}`;
    case 'plan_replanned': return `${actor}根据最近经历调整了计划：${String(event.payload.newGoal ?? '')}`;
    case 'encounter_started': return '我在近处看见了另一名幸存者；彼此可见，但尚未交换姓名、计划、知识或物资。';
    default: return `${actor}经历了 ${event.type}。`;
  }
}

function tagsOf(event: WorldEvent): string[] {
  const tags = new Set<string>([event.type]);
  if (event.actorId) tags.add(event.actorId);
  if (event.targetId) tags.add(event.targetId);
  if (typeof event.payload.kind === 'string') tags.add(event.payload.kind);
  if (['handover_completed', 'handover_refused', 'item_taken_owned', 'message_spoken', 'encounter_started'].includes(event.type)) tags.add('social');
  if (['resource_discovered', 'resource_harvested'].includes(event.type)) tags.add('resource');
  return [...tags];
}

export function observeWorldEvent(world: Mvp2World, event: WorldEvent): void {
  for (const observerId of new Set(event.observers)) {
    const observer = world.agents[observerId];
    if (!observer) continue;
    observer.recentObservedEventIds.push(event.eventId);
    observer.recentObservedEventIds = observer.recentObservedEventIds.slice(-12);
    const important = event.salience >= 7 || IMPORTANT_EVENT_TYPES.has(event.type);
    if (!important || observer.episodicMemories.some((memory) => memory.sourceEventIds.includes(event.eventId))) continue;
    const memory: EpisodicMemory = {
      memoryId: `memory_${observer.id}_${event.eventId}`,
      sourceEventIds: [event.eventId],
      summary: summaryOf(world, event),
      tags: tagsOf(event),
      importance: event.salience,
      createdAt: event.gameTime,
    };
    observer.episodicMemories.push(memory);
    observer.episodicMemories = observer.episodicMemories.slice(-64);
  }
}

export function runDailyReflections(world: Mvp2World): void {
  const currentDay = Math.floor(world.gameTime / 1440) + 1;
  for (const agent of Object.values(world.agents)) {
    if (currentDay <= agent.lastReflectionDay) continue;
    const source = agent.episodicMemories.filter((memory) => Math.floor(memory.createdAt / 1440) + 1 <= agent.lastReflectionDay).sort((a, b) => b.importance - a.importance).slice(0, 3);
    if (source.length) {
      const social = source.filter((memory) => memory.tags.includes('social'));
      agent.reflections.push({
        reflectionId: `reflection_${agent.id}_day_${agent.lastReflectionDay}`,
        day: agent.lastReflectionDay,
        summary: source.map((memory) => memory.summary).join(' '),
        sourceMemoryIds: source.map((memory) => memory.memoryId),
        beliefUpdates: source.map((memory) => `我会把${memory.summary}作为后续判断的事实依据。`).slice(0, 3),
        relationshipNotes: social.map((memory) => memory.summary).slice(0, 2),
        strategyLessons: source.some((memory) => memory.tags.includes('resource')) ? ['已亲眼确认的资源位置比传闻更可靠。'] : [],
        createdAt: world.gameTime,
      });
      agent.reflections = agent.reflections.slice(-7);
    }
    agent.lastReflectionDay = currentDay;
  }
}

export function relevantMemories(agent: AgentState, objective: string, limit = 6): EpisodicMemory[] {
  const terms = new Set([...objective].filter((char) => /[\p{L}\p{N}]/u.test(char)));
  return [...agent.episodicMemories]
    .map((memory) => ({ memory, score: memory.importance + [...terms].filter((term) => memory.summary.includes(term)).length * 2 }))
    .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
    .slice(0, limit)
    .map(({ memory }) => memory);
}

export function createOfferFact(world: Mvp2World, proposerId: string, recipientId: string, itemKind: OfferFact['itemKind'], amount: number, sourceEventId: string): OfferFact {
  const fact: OfferFact = {
    factId: `offer_${sourceEventId}`,
    kind: 'offer',
    proposerId,
    recipientId,
    itemKind,
    amount,
    sourceEventId,
    status: 'pending',
    createdAt: world.gameTime,
  };
  world.socialFacts[fact.factId] = fact;
  const recipient = world.agents[recipientId];
  if (recipient && !recipient.pendingOfferIds.includes(fact.factId)) recipient.pendingOfferIds.push(fact.factId);
  return fact;
}

export function pendingOffer(world: Mvp2World, offerId: string): OfferFact | null {
  const fact = world.socialFacts[offerId];
  return fact?.kind === 'offer' && fact.status === 'pending' ? fact : null;
}

export function resolveOfferFact(world: Mvp2World, offer: OfferFact, status: 'accepted' | 'refused' | 'expired' | 'failed', resolutionEventId?: string): void {
  offer.status = status;
  offer.resolvedAt = world.gameTime;
  offer.resolutionEventId = resolutionEventId;
  const recipient = world.agents[offer.recipientId];
  if (recipient) recipient.pendingOfferIds = recipient.pendingOfferIds.filter((id) => id !== offer.factId);
}

export function adjudicateSpeechAct(world: Mvp2World, actorId: string, targetId: string | undefined, text: string, declared: Mvp2SpeechAct): Mvp2SpeechAct {
  // Preserve every explicit structured label from the model. Only adjudicate
  // the generic `utterance` label when the already-spoken Chinese text carries
  // an unambiguous social act. This classifies evidence; it never chooses or
  // rewrites what the character says.
  if (declared !== 'utterance' || !targetId) return declared;
  const compact = text.replace(/\s+/g, '');
  const pendingRequest = Object.values(world.socialFacts).some((fact) => fact.kind === 'request'
    && fact.requesterId === targetId
    && fact.recipientId === actorId
    && fact.status === 'pending'
    && world.gameTime - fact.createdAt < 180);
  if (pendingRequest && /(不行|不能|不愿意|拒绝|别指望|做不到)/.test(compact)) return 'refuse';
  if (pendingRequest && /(^|[，。！？])(好|好的|可以|行|愿意)|我们(可以)?一起|一起(去|走|找|探索|采集)|我跟(着)?你/.test(compact)) return 'accept';
  if (/(这是|这个|那是|那个).{0,10}(我的|归我)|属于我/.test(compact)) return 'claim';
  if (/(我会|我保证|我答应).{1,50}(给你|告诉你|帮你|回来|做到|带来)/.test(compact)) return 'promise';
  if (/(请|能否|能不能|可不可以|告诉我|帮我)/.test(compact)
    || (/[？?]/.test(compact) && /(你|我们).{0,24}(知道|能|可以|愿意|一起|有|见过)/.test(compact))) return 'request';
  return declared;
}

export function recordSpeechFact(world: Mvp2World, event: WorldEvent, speechActType: Mvp2SpeechAct): SocialFact | null {
  if (!event.actorId || !event.targetId) return null;
  const text = String(event.payload.text ?? '').slice(0, 120);
  if (speechActType === 'claim') {
    const fact: SocialFact = { factId: `claim_${event.eventId}`, kind: 'claim', speakerId: event.actorId, listenerId: event.targetId, text, sourceEventId: event.eventId, status: 'unverified', createdAt: world.gameTime };
    world.socialFacts[fact.factId] = fact;
    if (/(这是|这个|那是|那个|这些|那些)?.{0,8}(是)?(我的|归我|我们共有|我们的)/.test(text)) {
      const ownership: SocialFact = {
        factId: `ownership_${event.eventId}`,
        kind: 'ownership_claim',
        claimantId: event.actorId,
        itemRef: text,
        scope: /我们|共有/.test(text) ? 'ours' : 'mine',
        sourceEventId: event.eventId,
        createdAt: world.gameTime,
      };
      world.socialFacts[ownership.factId] = ownership;
    }
    world.agents[event.targetId]?.beliefs.push({ beliefId: `belief_${fact.factId}`, kind: 'hearsay', topic: 'claim', proposition: text, confidence: 0.45, sourceEventIds: [event.eventId], aboutAgentId: event.actorId, updatedAt: world.gameTime });
    return fact;
  }
  if (speechActType === 'request') {
    const fact: SocialFact = { factId: `request_${event.eventId}`, kind: 'request', requesterId: event.actorId, recipientId: event.targetId, requestType: 'spoken_request', targetRef: text, sourceEventId: event.eventId, status: 'pending', createdAt: world.gameTime };
    world.socialFacts[fact.factId] = fact;
    return fact;
  }
  if (speechActType === 'promise') {
    const fact: SocialFact = { factId: `promise_${event.eventId}`, kind: 'promise', promiserId: event.actorId, beneficiaryId: event.targetId, action: text, dueBy: world.gameTime + 360, sourceEventId: event.eventId, status: 'pending', createdAt: world.gameTime };
    world.socialFacts[fact.factId] = fact;
    return fact;
  }
  if (speechActType === 'accept') {
    const request = Object.values(world.socialFacts).filter((fact): fact is Extract<SocialFact, { kind: 'request' }> => fact.kind === 'request' && fact.requesterId === event.targetId && fact.recipientId === event.actorId && fact.status === 'pending').sort((a, b) => b.createdAt - a.createdAt)[0];
    if (request) {
      request.status = 'accepted';
      request.resolvedAt = world.gameTime;
      const joint: SocialFact = { factId: `joint_${event.eventId}`, kind: 'joint_intent', participantIds: [event.actorId, event.targetId], intent: request.targetRef ?? request.requestType, sourceEventIds: [request.sourceEventId, event.eventId], status: 'active', createdAt: world.gameTime, updatedAt: world.gameTime };
      world.socialFacts[joint.factId] = joint;
      return joint;
    }
  }
  if (speechActType === 'refuse') {
    const request = Object.values(world.socialFacts).filter((fact): fact is Extract<SocialFact, { kind: 'request' }> => fact.kind === 'request' && fact.requesterId === event.targetId && fact.recipientId === event.actorId && fact.status === 'pending').sort((a, b) => b.createdAt - a.createdAt)[0];
    if (request) {
      request.status = 'refused';
      request.resolvedAt = world.gameTime;
      return request;
    }
  }
  return null;
}

function relationFor(agent: AgentState, otherId: string) {
  return (agent.relationships[otherId] ??= { trust: 0, resentment: 0, dependency: 0, affinity: 0 });
}

export function addRelationshipEvidence(world: Mvp2World, input: Omit<RelationshipEvidence, 'evidenceId'>): RelationshipEvidence | null {
  if (world.relationshipEvidence.some((evidence) => evidence.sourceEventId === input.sourceEventId && evidence.observerId === input.observerId && evidence.otherId === input.otherId && evidence.kind === input.kind)) return null;
  const evidence: RelationshipEvidence = { ...input, evidenceId: `relationship_${world.relationshipEvidence.length + 1}` };
  world.relationshipEvidence.push(evidence);
  const observer = world.agents[input.observerId];
  if (!observer) return evidence;
  observer.relationshipEvidence.push(evidence);
  const relationship = relationFor(observer, input.otherId);
  const personality = getProfile(observer.profileId).personality;
  const positiveWeight = 0.65 + personality.reciprocitySensitivity / 100;
  const negativeWeight = 0.65 + personality.lossAversion / 100;
  const weighted = input.valence * input.confidence * (input.valence >= 0 ? positiveWeight : negativeWeight);
  relationship.trust = Math.max(0, Math.min(100, relationship.trust + weighted));
  if (weighted >= 0) relationship.affinity = Math.max(0, Math.min(100, relationship.affinity + weighted * 0.45));
  else relationship.resentment = Math.max(0, Math.min(100, relationship.resentment + Math.abs(weighted) * 0.7));
  return evidence;
}

export function reduceSocialEvent(world: Mvp2World, event: WorldEvent): void {
  if (event.type === 'handover_completed' && event.actorId && event.targetId) {
    addRelationshipEvidence(world, { sourceEventId: event.eventId, observerId: event.targetId, otherId: event.actorId, kind: 'helped_me', valence: 6, confidence: 1, gameTime: event.gameTime });
  } else if (event.type === 'handover_refused' && event.actorId && event.targetId) {
    addRelationshipEvidence(world, { sourceEventId: event.eventId, observerId: event.actorId, otherId: event.targetId, kind: 'refused_request', valence: -2, confidence: 1, gameTime: event.gameTime });
  } else if (event.type === 'item_taken_owned' && event.actorId) {
    const ownerId = typeof event.payload.droppedBy === 'string' ? event.payload.droppedBy : undefined;
    if (ownerId && ownerId !== event.actorId) addRelationshipEvidence(world, { sourceEventId: event.eventId, observerId: ownerId, otherId: event.actorId, kind: 'took_claimed_item', valence: -7, confidence: 1, gameTime: event.gameTime });
  } else if (event.type === 'promise_kept' && event.actorId && event.targetId) {
    addRelationshipEvidence(world, { sourceEventId: event.eventId, observerId: event.targetId, otherId: event.actorId, kind: 'kept_promise', valence: 7, confidence: 1, gameTime: event.gameTime });
  } else if (event.type === 'promise_broken' && event.actorId && event.targetId) {
    addRelationshipEvidence(world, { sourceEventId: event.eventId, observerId: event.targetId, otherId: event.actorId, kind: 'broke_promise', valence: -8, confidence: 1, gameTime: event.gameTime });
  }
}

export function adjudicateSocialFacts(world: Mvp2World): Array<{ type: 'promise_kept' | 'promise_broken'; factId: string; actorId: string; targetId: string }> {
  const results: Array<{ type: 'promise_kept' | 'promise_broken'; factId: string; actorId: string; targetId: string }> = [];
  for (const fact of Object.values(world.socialFacts)) {
    if (fact.kind === 'offer' && fact.status === 'pending' && world.gameTime - fact.createdAt >= 180) resolveOfferFact(world, fact, 'expired');
    if (fact.kind === 'request' && fact.status === 'pending' && world.gameTime - fact.createdAt >= 180) {
      fact.status = 'expired';
      fact.resolvedAt = world.gameTime;
    }
    if (fact.kind !== 'promise' || fact.status !== 'pending') continue;
    const fulfilled = world.events.some((event) => event.gameTime >= fact.createdAt && event.actorId === fact.promiserId && event.targetId === fact.beneficiaryId && event.type === 'handover_completed');
    if (fulfilled) {
      fact.status = 'kept';
      fact.resolvedAt = world.gameTime;
      world.agents[fact.promiserId].stats.promisesKept++;
      results.push({ type: 'promise_kept', factId: fact.factId, actorId: fact.promiserId, targetId: fact.beneficiaryId });
    } else if (world.gameTime >= fact.dueBy) {
      fact.status = world.agents[fact.promiserId]?.isAlive ? 'broken' : 'impossible';
      fact.resolvedAt = world.gameTime;
      if (fact.status === 'broken') {
        world.agents[fact.promiserId].stats.promisesBroken++;
        results.push({ type: 'promise_broken', factId: fact.factId, actorId: fact.promiserId, targetId: fact.beneficiaryId });
      }
    }
  }
  return results;
}

function normalizeUtterance(text: string): string {
  return text.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

function bigrams(text: string): Set<string> {
  const chars = [...text];
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]));
}

export function utteranceSimilarity(a: string, b: string): number {
  const aa = bigrams(normalizeUtterance(a));
  const bb = bigrams(normalizeUtterance(b));
  if (!aa.size && !bb.size) return 1;
  const intersection = [...aa].filter((entry) => bb.has(entry)).length;
  return (2 * intersection) / Math.max(1, aa.size + bb.size);
}

export function detectRepetition(world: Mvp2World, event: WorldEvent): void {
  if (event.type !== 'message_spoken' || !event.actorId || !event.targetId) return;
  const text = String(event.payload.text ?? '');
  const pair = [event.actorId, event.targetId].sort() as [string, string];
  const previous = [...world.events].reverse().find((candidate) => candidate.eventId !== event.eventId && candidate.type === 'message_spoken' && candidate.actorId && candidate.targetId && [candidate.actorId, candidate.targetId].sort().join('|') === pair.join('|') && event.gameTime - candidate.gameTime <= 360);
  if (!previous) return;
  const similarity = utteranceSimilarity(text, String(previous.payload.text ?? ''));
  if (similarity < 0.88) return;
  world.repetitionIncidents.push({ incidentId: `repetition_${event.eventId}`, pair, sourceEventId: event.eventId, comparedEventId: previous.eventId, similarity, gameTime: event.gameTime });
}

export function shouldReplan(world: Mvp2World, agent: AgentState): boolean {
  const plan = agent.plan;
  if (!plan || plan.currentStepIndex >= plan.steps.length || plan.steps.every((step) => ['done', 'failed', 'skipped'].includes(step.status))) return true;
  if (agent.pendingConversation || agent.pendingOfferIds.length) return true;
  return world.events.some((event) => event.gameTime > plan.lastReplannedAt && event.observers.includes(agent.id) && event.salience >= 8);
}

export function makePersistentPlan(agent: AgentState, goal: string, rawSteps: Array<{ intent: string; actionType: string; targetRef?: string; successCondition?: string; abortConditions?: string[] }>, reasonForPlan: string, world: Mvp2World): AgentPlan {
  const steps: PlanStep[] = rawSteps.slice(0, 5).map((step, index) => ({
    stepId: `step_${world.actionSeq}_${agent.id}_${index + 1}`,
    intent: step.intent,
    actionType: normalizeActionType(step.actionType),
    targetRef: step.targetRef,
    successCondition: step.successCondition || `完成：${step.intent}`,
    abortConditions: step.abortConditions ?? [],
    status: index === 0 ? 'active' : 'pending',
  }));
  if (!steps.length) steps.push({ stepId: `step_${world.actionSeq}_${agent.id}_1`, intent: '观察后再决定', actionType: 'observe', successCondition: '获得新的观察', abortConditions: [], status: 'active' });
  return {
    planId: `plan_${world.actionSeq}_${agent.id}`,
    goal,
    steps,
    currentStepIndex: 0,
    reasonForPlan,
    lastReplannedAt: world.gameTime,
    evidenceEventIds: agent.recentObservedEventIds.slice(-5),
    createdAt: world.gameTime,
    updatedAt: world.gameTime,
  };
}

export function normalizeActionType(value: string): ActionType | 'decide_after_observation' {
  const map: Record<string, ActionType> = {
    move_to: 'move', explore: 'explore', pickup: 'pickup_item', pickup_item: 'pickup_item', drop: 'drop_item',
    harvest: 'harvest_food', consume: 'consume', offer: 'offer_item', offer_item: 'offer_item', accept: 'accept_handover',
    accept_handover: 'accept_handover', refuse: 'refuse_handover', refuse_handover: 'refuse_handover', search: 'search_wreckage',
    talk: 'talk', shout: 'shout', build_fire: 'build_fire', add_fuel: 'add_fuel', sleep: 'sleep', wake: 'wake', rest: 'rest', observe: 'observe',
  };
  const direct = new Set<ActionType>([
    'move', 'explore', 'pickup_item', 'drop_item', 'offer_item', 'accept_handover', 'refuse_handover',
    'take_unattended_item', 'search_wreckage', 'harvest_water', 'harvest_food', 'harvest_wood', 'consume',
    'build_fire', 'add_fuel', 'sleep', 'wake', 'rest', 'shout', 'talk', 'observe',
  ]);
  return map[value] ?? (direct.has(value as ActionType) ? value as ActionType : 'observe');
}

function planActionMatches(step: PlanStep, action: ActionInstance): boolean {
  if (step.actionType === action.type) return true;
  if (step.actionType === 'harvest_food' && ['harvest_water', 'harvest_food', 'harvest_wood'].includes(action.type)) return true;
  if (step.actionType === 'decide_after_observation' && action.type === 'observe') return true;
  return false;
}

export function bindActionToPlan(agent: AgentState, action: ActionInstance): void {
  const plan = agent.plan;
  const step = plan?.steps[plan.currentStepIndex];
  if (!plan || !step || step.status !== 'active' || !planActionMatches(step, action)) return;
  action.planId = plan.planId;
  action.planStepId = step.stepId;
  step.sourceActionId = action.actionId;
}

export function advancePlanAfterAction(agent: AgentState, action: ActionInstance, gameTime: number): PlanStep | null {
  const plan = agent.plan;
  if (!plan || action.planId !== plan.planId || !action.planStepId || !action.committed) return null;
  const step = plan.steps[plan.currentStepIndex];
  if (!step || step.stepId !== action.planStepId || step.status !== 'active') return null;
  step.status = 'done';
  step.completedAt = gameTime;
  plan.currentStepIndex++;
  const next = plan.steps[plan.currentStepIndex];
  if (next?.status === 'pending') next.status = 'active';
  plan.updatedAt = gameTime;
  return step;
}
