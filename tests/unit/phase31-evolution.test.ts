import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { carryCapacity } from '../../server/mvp2/items';
import { buildPlannerMessages } from '../../server/mvp2/planner';
import { createMvp2World } from '../../server/mvp2/world';
import { emitEvent, startAction, stepWorldMovement } from '../../server/mvp2/engine';
import {
  adjudicateSpeechAct,
  makePersistentPlan,
  recordSpeechFact,
  shouldReplan,
  utteranceSimilarity,
} from '../../server/mvp2/evolution';
import { tickNeeds } from '../../server/mvp2/survival';
import type { Mvp2World, OfferFact, PromiseFact } from '../../server/mvp2/types';

function makeWorld(id = 'phase31-evolution'): Mvp2World {
  const map = RuntimeMap.loadDefault();
  return createMvp2World(id, 20260809, map);
}

function placeTogether(world: Mvp2World): void {
  const [a, b, c] = Object.values(world.agents);
  a.x = 20; a.y = 46;
  b.x = 21; b.y = 46;
  c.x = 22; c.y = 46;
}

describe('Phase 3.1 evolution contract', () => {
  test('EVO-001/002: observed high-salience events become bounded episodic memory and one daily reflection', () => {
    const world = makeWorld();
    const agent = world.agents.agent_a;
    const event = emitEvent(world, 'resource_discovered', agent.id, 'spring_test', { kind: 'water' }, [agent.id], 8);
    expect(agent.recentObservedEventIds).toContain(event.eventId);
    expect(agent.episodicMemories.some((memory) => memory.sourceEventIds.includes(event.eventId))).toBe(true);

    for (let i = 0; i < 15; i++) emitEvent(world, 'ambient_observation', undefined, undefined, { index: i }, [agent.id], 1);
    expect(agent.recentObservedEventIds).toHaveLength(12);

    stepWorldMovement(world, 961);
    expect(agent.reflections).toHaveLength(1);
    expect(agent.reflections[0].sourceMemoryIds.length).toBeGreaterThan(0);
    stepWorldMovement(world, 1);
    expect(agent.reflections).toHaveLength(1);
  });

  test('a physical encounter is observed once per proximity entry without introducing identities or changing relationships', () => {
    const world = makeWorld('encounter-fact');
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    const c = world.agents.agent_c;
    const initial = world.events.filter((event) => event.type === 'encounter_started');
    expect(initial).toHaveLength(2);
    expect(world.nearbyPairs).toEqual(['agent_a|agent_b', 'agent_b|agent_c']);
    expect(a.knowledge.introducedTo).toEqual([]);
    expect(b.knowledge.introducedTo).toEqual([]);
    expect(c.knowledge.introducedTo).toEqual([]);
    expect(Object.keys(a.relationships)).toHaveLength(0);
    expect(a.episodicMemories.some((memory) => memory.summary.includes('尚未交换姓名'))).toBe(true);

    stepWorldMovement(world, 1);
    expect(world.events.filter((event) => event.type === 'encounter_started')).toHaveLength(2);
    b.x = 60; b.y = 20;
    stepWorldMovement(world, 1);
    expect(world.nearbyPairs).toEqual([]);
    b.x = a.x + 1; b.y = a.y;
    stepWorldMovement(world, 1);
    expect(world.events.filter((event) => event.type === 'encounter_started')).toHaveLength(3);
    expect(Object.keys(a.relationships)).toHaveLength(0);
  });

  test('EVO-004: offer is bilateral; inventory moves only after recipient acceptance', () => {
    const world = makeWorld('offer-accept');
    placeTogether(world);
    const giver = world.agents.agent_a;
    const receiver = world.agents.agent_b;
    giver.inventory.water = 2;
    giver.carryUsed = 2;

    expect(startAction(world, giver, { type: 'offer_item', target: { kind: 'agent', agentId: receiver.id }, itemKind: 'water', amount: 1 })).not.toBeNull();
    stepWorldMovement(world, 8);
    const offer = Object.values(world.socialFacts).find((fact): fact is OfferFact => fact.kind === 'offer')!;
    expect(offer.status).toBe('pending');
    expect(giver.inventory.water).toBe(2);
    expect(receiver.inventory.water ?? 0).toBe(0);
    expect(receiver.pendingOfferIds).toContain(offer.factId);

    expect(startAction(world, receiver, { type: 'accept_handover', target: { kind: 'offer', offerId: offer.factId } })).not.toBeNull();
    stepWorldMovement(world, 8);
    expect(offer.status).toBe('accepted');
    expect(giver.inventory.water).toBe(1);
    expect(receiver.inventory.water).toBe(1);
    expect(world.events.some((event) => event.type === 'handover_completed' && event.payload.offerId === offer.factId)).toBe(true);
  });

  test('EVO-004: refusal resolves the offer without moving inventory', () => {
    const world = makeWorld('offer-refuse');
    placeTogether(world);
    const giver = world.agents.agent_a;
    const receiver = world.agents.agent_b;
    giver.inventory.food = 1;
    giver.carryUsed = 1;
    startAction(world, giver, { type: 'offer_item', target: { kind: 'agent', agentId: receiver.id }, itemKind: 'food', amount: 1 });
    stepWorldMovement(world, 8);
    const offer = Object.values(world.socialFacts).find((fact): fact is OfferFact => fact.kind === 'offer')!;
    startAction(world, receiver, { type: 'refuse_handover', target: { kind: 'offer', offerId: offer.factId } });
    stepWorldMovement(world, 6);
    expect(offer.status).toBe('refused');
    expect(giver.inventory.food).toBe(1);
    expect(receiver.inventory.food ?? 0).toBe(0);
    expect(receiver.pendingOfferIds).not.toContain(offer.factId);
  });

  test('EVO-005: one persistent plan advances across multiple committed actions', () => {
    const world = makeWorld('persistent-plan');
    const agent = world.agents.agent_a;
    const plan = makePersistentPlan(agent, '先确认环境再休整', [
      { intent: '观察海滩', actionType: 'observe', successCondition: '获得一次观察' },
      { intent: '再次确认变化', actionType: 'observe', successCondition: '获得第二次观察' },
    ], '刚醒来，需要基于事实判断', world);
    agent.plan = plan;

    startAction(world, agent, { type: 'observe', target: { kind: 'none' } });
    stepWorldMovement(world, 6);
    expect(agent.plan.planId).toBe(plan.planId);
    expect(agent.plan.steps.map((step) => step.status)).toEqual(['done', 'active']);
    expect(shouldReplan(world, agent)).toBe(false);

    startAction(world, agent, { type: 'observe', target: { kind: 'none' } });
    stepWorldMovement(world, 6);
    expect(agent.plan.steps.map((step) => step.status)).toEqual(['done', 'done']);
    expect(agent.plan.currentStepIndex).toBe(2);
    expect(shouldReplan(world, agent)).toBe(true);
  });

  test('EVO-006/007: prompt exposes memory, full conversation, pending offers and repetition facts without directing behavior', () => {
    const world = makeWorld('prompt-evidence');
    placeTogether(world);
    const agent = world.agents.agent_a;
    const other = world.agents.agent_b;
    const important = emitEvent(world, 'resource_discovered', agent.id, 'spring_x', { kind: 'water' }, [agent.id], 9);
    const memoryId = agent.episodicMemories.find((memory) => memory.sourceEventIds.includes(important.eventId))!.memoryId;
    const first = emitEvent(world, 'message_spoken', agent.id, other.id, { text: '我会去看看那边的泉水。' }, [agent.id, other.id], 5);
    emitEvent(world, 'message_spoken', agent.id, other.id, { text: '我会去看看那边的泉水！' }, [agent.id, other.id], 5);
    world.conversations.conversation_test = {
      conversationId: 'conversation_test', participantIds: [agent.id, other.id], status: 'awaiting_response', currentSpeakerId: agent.id,
      turns: [{ turnId: 'turn_1', speakerId: other.id, text: '你找到水了吗？', speechActType: 'utterance', gameTime: world.gameTime, eventId: first.eventId }],
      startedAt: world.gameTime, updatedAt: world.gameTime,
    };
    agent.pendingConversation = { conversationId: 'conversation_test', fromId: other.id, text: '你找到水了吗？', createdAt: world.gameTime };
    const offerEvent = emitEvent(world, 'offer_created', other.id, agent.id, { kind: 'food', quantity: 1 }, [agent.id, other.id], 7);
    const offer: OfferFact = { factId: `offer_${offerEvent.eventId}`, kind: 'offer', proposerId: other.id, recipientId: agent.id, itemKind: 'food', amount: 1, sourceEventId: offerEvent.eventId, status: 'pending', createdAt: world.gameTime };
    world.socialFacts[offer.factId] = offer;
    agent.pendingOfferIds.push(offer.factId);

    const prompt = buildPlannerMessages(world, agent, []).map((message) => message.content).join('\n');
    expect(prompt).toContain(memoryId);
    expect(prompt).toContain('你找到水了吗？');
    expect(prompt).toContain(offer.factId);
    expect(prompt).toContain('重复表达记录');
    expect(prompt).not.toContain('先开口打个招呼');
    expect(prompt).not.toContain('最自然的做法');
    expect(utteranceSimilarity('我会去看看那边的泉水。', '我会去看看那边的泉水！')).toBe(1);
  });

  test('EVO-008: promises are adjudicated from later world evidence', () => {
    const brokenWorld = makeWorld('promise-broken');
    placeTogether(brokenWorld);
    const promiser = brokenWorld.agents.agent_a;
    const beneficiary = brokenWorld.agents.agent_b;
    const spoken = emitEvent(brokenWorld, 'message_spoken', promiser.id, beneficiary.id, { text: '我会把水交给你。' }, [promiser.id, beneficiary.id], 5);
    const promise = recordSpeechFact(brokenWorld, spoken, 'promise') as PromiseFact;
    stepWorldMovement(brokenWorld, 361);
    expect(promise.status).toBe('broken');
    expect(promiser.stats.promisesBroken).toBe(1);
    expect(brokenWorld.events.some((event) => event.type === 'promise_broken')).toBe(true);

    const keptWorld = makeWorld('promise-kept');
    placeTogether(keptWorld);
    const keptPromiser = keptWorld.agents.agent_a;
    const keptBeneficiary = keptWorld.agents.agent_b;
    const keptSpoken = emitEvent(keptWorld, 'message_spoken', keptPromiser.id, keptBeneficiary.id, { text: '我会给你食物。' }, [keptPromiser.id, keptBeneficiary.id], 5);
    const kept = recordSpeechFact(keptWorld, keptSpoken, 'promise') as PromiseFact;
    emitEvent(keptWorld, 'handover_completed', keptPromiser.id, keptBeneficiary.id, { kind: 'food', quantity: 1 }, [keptPromiser.id, keptBeneficiary.id], 8);
    stepWorldMovement(keptWorld, 1);
    expect(kept.status).toBe('kept');
    expect(keptPromiser.stats.promisesKept).toBe(1);
    expect(keptWorld.events.some((event) => event.type === 'promise_kept')).toBe(true);
  });

  test('EVO-003: claims, ownership, requests and joint intents are structured social facts', () => {
    const world = makeWorld('social-facts');
    placeTogether(world);
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    const claimEvent = emitEvent(world, 'message_spoken', a.id, b.id, { text: '这个背包是我的。' }, [a.id, b.id], 5);
    recordSpeechFact(world, claimEvent, 'claim');
    const requestEvent = emitEvent(world, 'message_spoken', a.id, b.id, { text: '请和我一起找水。' }, [a.id, b.id], 5);
    recordSpeechFact(world, requestEvent, 'request');
    const acceptEvent = emitEvent(world, 'message_spoken', b.id, a.id, { text: '好，我同意。' }, [a.id, b.id], 5);
    recordSpeechFact(world, acceptEvent, 'accept');
    const kinds = Object.values(world.socialFacts).map((fact) => fact.kind);
    expect(kinds).toEqual(expect.arrayContaining(['claim', 'ownership_claim', 'request', 'joint_intent']));
  });

  test('generic model utterances are conservatively adjudicated into explicit request and joint intent evidence', () => {
    const world = makeWorld('speech-act-adjudication');
    placeTogether(world);
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    const requestText = '你知道附近哪里有水源吗？我们可以一起找找。';
    const requestType = adjudicateSpeechAct(world, a.id, b.id, requestText, 'utterance');
    expect(requestType).toBe('request');
    const requestEvent = emitEvent(world, 'message_spoken', a.id, b.id, { text: requestText, speechActType: requestType }, [a.id, b.id], 5);
    recordSpeechFact(world, requestEvent, requestType);

    const acceptText = '好的，我们一起去找水。';
    const acceptType = adjudicateSpeechAct(world, b.id, a.id, acceptText, 'utterance');
    expect(acceptType).toBe('accept');
    const acceptEvent = emitEvent(world, 'message_spoken', b.id, a.id, { text: acceptText, speechActType: acceptType }, [a.id, b.id], 5);
    recordSpeechFact(world, acceptEvent, acceptType);

    const facts = Object.values(world.socialFacts);
    expect(facts.some((fact) => fact.kind === 'request' && fact.status === 'accepted')).toBe(true);
    expect(facts.some((fact) => fact.kind === 'joint_intent' && fact.status === 'active')).toBe(true);
    expect(adjudicateSpeechAct(world, a.id, b.id, '我先看看周围。', 'utterance')).toBe('utterance');
  });

  test('unanswered requests expire and cannot turn a much later acknowledgement into an acceptance', () => {
    const world = makeWorld('request-expiry');
    placeTogether(world);
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    const spoken = emitEvent(world, 'message_spoken', a.id, b.id, { text: '你能和我一起找水吗？' }, [a.id, b.id], 5);
    const request = recordSpeechFact(world, spoken, 'request');
    expect(request?.kind).toBe('request');
    stepWorldMovement(world, 180);
    expect(request?.kind === 'request' && request.status).toBe('expired');
    expect(adjudicateSpeechAct(world, b.id, a.id, '好的。', 'utterance')).toBe('utterance');
  });

  test('EVO-009: profile parameters change actual carrying, needs and harvest mechanics', () => {
    const world = makeWorld('profile-mechanics');
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    const c = world.agents.agent_c;
    expect(carryCapacity(world, b)).toBeGreaterThan(carryCapacity(world, a));
    expect(carryCapacity(world, a)).toBeGreaterThan(carryCapacity(world, c));

    for (const agent of [a, b, c]) tickNeeds(agent, 60, false, false, false);
    expect(c.needs.water).toBeGreaterThan(b.needs.water);

    const berry = Object.values(world.resources).find((resource) => resource.kind === 'berry_bush')!;
    for (const agent of [a, b, c]) {
      agent.x = berry.x;
      agent.y = berry.y;
      agent.knowledge.knownResources.push(berry.resourceId);
    }
    const actionA = startAction(world, a, { type: 'harvest_food', target: { kind: 'resource', resourceId: berry.resourceId }, amount: 1 })!;
    const actionC = startAction(world, c, { type: 'harvest_food', target: { kind: 'resource', resourceId: berry.resourceId }, amount: 1 })!;
    expect(actionC.endsAt - actionC.startedAt).toBeLessThan(actionA.endsAt - actionA.startedAt);

    const yieldWorld = makeWorld('profile-yield');
    const researcher = yieldWorld.agents.agent_c;
    const yieldBerry = Object.values(yieldWorld.resources).find((resource) => resource.kind === 'berry_bush')!;
    researcher.x = yieldBerry.x;
    researcher.y = yieldBerry.y;
    researcher.knowledge.knownResources.push(yieldBerry.resourceId);
    startAction(yieldWorld, researcher, { type: 'harvest_food', target: { kind: 'resource', resourceId: yieldBerry.resourceId }, amount: 1 });
    stepWorldMovement(yieldWorld, 7);
    expect(researcher.inventory.food).toBeGreaterThan(1);
  });

  test('sleep is a bounded physical session and returns through a visible wake action', () => {
    const world = makeWorld('natural-wake');
    const agent = world.agents.agent_a;
    startAction(world, agent, { type: 'sleep', target: { kind: 'none' } });
    stepWorldMovement(world, 240);
    expect(agent.sleep?.sleeping).toBe(true);
    stepWorldMovement(world, 240);
    expect(agent.currentAction?.type).toBe('wake');
    const wakeStarted = [...world.events].reverse().find((event) => event.type === 'action_started' && event.payload.type === 'wake');
    expect(wakeStarted?.payload.provenanceKind).toBe('system');
    stepWorldMovement(world, 5);
    expect(agent.sleep).toBeNull();
    expect(world.events.some((event) => event.type === 'woke_up' && event.actorId === agent.id)).toBe(true);
  });
});
