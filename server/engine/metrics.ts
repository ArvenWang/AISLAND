// Post-hoc behavior analyzer (PRD 25.1-25.3): cooperation, competition,
// reciprocity, strategy shifts, alliance windows, outcome classification.

import { MINUTES_PER_DAY } from './scenario';
import type { BehaviorMetrics, WorldEvent, WorldState } from './types';

const COOP_TYPES = new Set(['resource_given', 'resource_stored', 'location_shared', 'promise_fulfilled']);
const COMP_TYPES = new Set(['promise_broken', 'harvest_blocked', 'action_interrupted']);

export function computeMetrics(world: WorldState): BehaviorMetrics {
  const events = world.events;
  const cooperationEvents: string[] = [];
  const competitionEvents: string[] = [];
  const contentionEvents: string[] = [];

  // Contention: two harvests at the same node within 30 island minutes by different agents.
  const harvests = events.filter((e) => e.type === 'harvest_completed');
  for (let i = 0; i < harvests.length; i++) {
    for (let j = i + 1; j < harvests.length; j++) {
      const a = harvests[i];
      const b = harvests[j];
      if (a.actorId === b.actorId || a.locationId !== b.locationId) continue;
      if (Math.abs(a.gameTime - b.gameTime) <= 30) {
        contentionEvents.push(a.eventId, b.eventId);
      }
    }
  }

  for (const e of events) {
    if (COOP_TYPES.has(e.type)) cooperationEvents.push(e.eventId);
    if (COMP_TYPES.has(e.type)) competitionEvents.push(e.eventId);
    if (e.type === 'message_spoken' && e.payload?.speechActType === 'reject_request') competitionEvents.push(e.eventId);
  }

  // Reciprocity loops: A helps B, then B helps A (or shares location) within 6 island hours.
  const helpEvents = events.filter((e) => e.type === 'resource_given' || e.type === 'location_shared');
  const reciprocityLoops = countReciprocity(helpEvents);

  // Strategy shifts from rolling behavior windows.
  const strategyShifts = detectStrategyShifts(world);
  const perAgentLabels = rollingLabels(world);

  // Alliance windows from relationship history.
  const allianceWindows = detectAllianceWindows(world);

  // Promise tally.
  const promises = {
    total: world.promiseLedger.length,
    fulfilled: world.promiseLedger.filter((p) => p.status === 'fulfilled').length,
    broken: world.promiseLedger.filter((p) => p.status === 'broken').length,
    cancelled: world.promiseLedger.filter((p) => p.status === 'cancelled').length,
    impossible: world.promiseLedger.filter((p) => p.status === 'impossible').length,
    pending: world.promiseLedger.filter((p) => p.status === 'pending').length,
  };

  const survivors = Object.values(world.agents).filter((a) => a.isAlive);
  const conflicts = competitionEvents.length + contentionEvents.length;
  let outcomeClass: string;
  if (survivors.length === 3) outcomeClass = conflicts >= 3 ? 'three_survive_conflict' : 'three_survive';
  else if (survivors.length === 2) outcomeClass = conflicts >= 3 ? 'two_survive_conflict' : 'two_survive';
  else if (survivors.length === 1) outcomeClass = 'one_survive';
  else outcomeClass = 'all_dead';

  // Waste rate: consumed vs total available (initial + regen).
  const totalConsumed = Object.values(world.agents).reduce(
    (acc, a) => acc + a.stats.consumed.water + a.stats.consumed.food,
    0,
  );
  const initial = 6 + 3 + 5 + 5 + 2 + 2; // emergency + spring + grove + tide pool
  const regen = 5 * 4 + 2 * 4; // spring & tide pool daily regen (days 2-5)
  const totalAvailable = initial + regen;
  const wasteRate = Math.max(0, 1 - totalConsumed / Math.max(1, totalAvailable));

  const conversationCount = events.filter((e) => e.type === 'conversation_ended').length;
  const requestResponseCount = events.filter((e) => e.payload?.speechActType === 'accept_request' || e.payload?.speechActType === 'reject_request').length;

  const invalidActionCount = world.agents[Object.keys(world.agents)[0]]?.invalidActionStreak ?? 0;
  const hiddenInfoViolations = 0; // enforced by GameMaster; any violation is a P1 and would be counted elsewhere

  return {
    cooperationEvents: [...new Set(cooperationEvents)],
    competitionEvents: [...new Set(competitionEvents)],
    contentionEvents: [...new Set(contentionEvents)],
    reciprocityLoops,
    strategyShifts,
    allianceWindows,
    promises,
    outcomeClass,
    wasteRate: Math.round(wasteRate * 1000) / 1000,
    invalidActionCount,
    hiddenInfoViolations,
    llmWaitFraction: 0,
    conversationCount,
    requestResponseCount,
    perAgentLabels,
  };
}

function countReciprocity(helpEvents: WorldEvent[]): number {
  let loops = 0;
  for (const e of helpEvents) {
    if (!e.actorId || !e.targetId) continue;
    const later = helpEvents.find(
      (o) =>
        o.eventId !== e.eventId &&
        o.actorId === e.targetId &&
        o.targetId === e.actorId &&
        o.gameTime > e.gameTime &&
        o.gameTime - e.gameTime <= 6 * 60,
    );
    if (later) loops++;
  }
  return loops;
}

function detectStrategyShifts(world: WorldState): BehaviorMetrics['strategyShifts'] {
  const shifts: BehaviorMetrics['strategyShifts'] = [];
  const WINDOW = 6 * 60;
  for (const agent of Object.values(world.agents)) {
    const myEvents = world.events.filter((e) => e.actorId === agent.id && e.gameTime >= 30);
    if (myEvents.length < 3) continue;
    let prevLabel = '观望';
    for (let i = 1; i < myEvents.length; i++) {
      const e = myEvents[i];
      const windowEvents = myEvents.filter((x) => x.gameTime > e.gameTime - WINDOW && x.gameTime <= e.gameTime);
      const score = scoreWindow(windowEvents, agent.id);
      const label = score > 1.5 ? '合作中' : score < -1.5 ? '优先自保' : '观望';
      if (label !== prevLabel) {
        const trigger = windowEvents[windowEvents.length - 1];
        if (trigger && i >= 1) {
          shifts.push({
            agentId: agent.id,
            from: prevLabel,
            to: label,
            gameTime: e.gameTime,
            triggerEventId: trigger.eventId,
          });
        }
        prevLabel = label;
      }
    }
  }
  return shifts;
}

function scoreWindow(events: WorldEvent[], _agentId: string): number {
  let s = 0;
  for (const e of events) {
    if (e.type === 'resource_given' || e.type === 'location_shared' || e.type === 'resource_stored') s += 1;
    if (e.type === 'promise_fulfilled') s += 1.5;
    if (e.type === 'promise_broken') s -= 2;
    if (e.type === 'message_spoken' && e.payload?.speechActType === 'reject_request') s -= 1;
    if (e.type === 'harvest_blocked') s -= 1;
  }
  return s;
}

function rollingLabels(world: WorldState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const agent of Object.values(world.agents)) {
    const labels: string[] = [];
    const myEvents = world.events.filter((e) => e.actorId === agent.id);
    for (const e of myEvents) {
      const window = myEvents.filter((x) => x.gameTime > e.gameTime - 6 * 60 && x.gameTime <= e.gameTime);
      const s = scoreWindow(window, agent.id);
      if (s > 1.5) labels.push('合作中');
      else if (s < -1.5) labels.push('优先自保');
      else labels.push('观望');
    }
    out[agent.id] = labels;
  }
  return out;
}

function detectAllianceWindows(world: WorldState): BehaviorMetrics['allianceWindows'] {
  const windows: BehaviorMetrics['allianceWindows'] = [];
  const ids = Object.keys(world.agents);
  const pairs: Array<[string, string]> = [
    [ids[0], ids[1]],
    [ids[0], ids[2]],
    [ids[1], ids[2]],
  ];
  const MIN_TRUST = 30;
  const MIN_DURATION = 6 * 60; // island minutes
  const MIN_GAP = 20;

  for (const [a, b] of pairs) {
    const histA = world.relationshipHistory[a][b];
    const histB = world.relationshipHistory[b][a];
    if (!histA.length) continue;
    let windowStart: number | null = null;
    let windowEnd: number | null = null;
    for (let i = 0; i < histA.length; i++) {
      const h = histA[i];
      const hb = histB[i] ?? h;
      const third = ids.find((x) => x !== a && x !== b)!;
      const thirdATrust = Math.abs(world.agents[a].relationships[third]?.trust ?? 0);
      const thirdBTrust = Math.abs(world.agents[b].relationships[third]?.trust ?? 0);
      const cond =
        h.trust >= MIN_TRUST &&
        hb.trust >= MIN_TRUST &&
        h.trust - thirdATrust >= MIN_GAP &&
        hb.trust - thirdBTrust >= MIN_GAP;
      if (cond && windowStart === null) {
        windowStart = h.gameTime;
        windowEnd = h.gameTime;
      } else if (cond && windowStart !== null) {
        windowEnd = h.gameTime;
      } else if (!cond && windowStart !== null) {
        if ((windowEnd ?? windowStart) - windowStart >= MIN_DURATION) {
          windows.push({ pair: [a, b], from: windowStart, to: windowEnd ?? windowStart });
        }
        windowStart = null;
        windowEnd = null;
      }
    }
    if (windowStart !== null && (windowEnd ?? windowStart) - windowStart >= MIN_DURATION) {
      windows.push({ pair: [a, b], from: windowStart, to: windowEnd ?? windowStart });
    }
  }
  return windows;
}

export function dayOf(gameTime: number): number {
  return Math.floor(gameTime / MINUTES_PER_DAY) + 1;
}
