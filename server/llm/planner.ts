// Structured planner: builds per-agent context (PRD 10.1), calls the LLM,
// parses the indexed action choice, repairs once, and returns an ActionIntent.

import { getProfile, compileMechanics, promptSelfDescription } from '../engine/profile';
import { formatGameTime } from '../engine/scenario';
import { buildAvailableActions, locationName, type ActionOption } from '../engine/systems';
import { LlmAdapter, type LlmCallResult } from './adapter';
import type { Action, ActionIntent, WorldState } from '../engine/types';

export type PlannerOutput = {
  actionIndex: number;
  publicIntent: string;
  privateMotive: string;
  fallbackActionIndex?: number;
};

export function buildPlannerContext(world: WorldState, agentId: string): { prompt: string; options: ActionOption[] } {
  const agent = world.agents[agentId];
  const profile = getProfile(agent.profileId);
  const mech = compileMechanics(profile);
  const options = buildAvailableActions(world, agent);
  const parts: string[] = [];
  parts.push('【系统】你是荒岛生存模拟中的一名角色。你只能从“可用动作”中选择一个动作（输出其编号）。你的选择会真实影响你的生存和与他人的关系。请用中文输出。');
  parts.push('【角色】');
  parts.push(promptSelfDescription(profile));
  parts.push(`我的携带上限：${mech.carryCapacity} 单位。`);
  parts.push('');
  parts.push('【当前状态】');
  parts.push(`游戏时间：${formatGameTime(world.gameTime)}（第${Math.floor(world.gameTime / 1440) + 1}天）。`);
  parts.push(`位置：${locationName(world, nearestLocationId(world, agentId))}附近。`);
  parts.push(`口渴度：${Math.round(agent.needs.water)}（越低越危险，低于25为危急，低于10濒死）。`);
  parts.push(`饥饿度：${Math.round(agent.needs.food)}（越低越危险，低于30应尽快进食，低于15濒死）。`);
  parts.push(`体力：${Math.round(agent.needs.stamina)}（低于15无法进行重体力动作）。`);
  parts.push(`健康：${Math.round(agent.needs.health)}（到0即死亡）。`);
  parts.push(`个人库存：水 ${agent.inventory.water}，食物 ${agent.inventory.food}。`);
  parts.push(`当前动作：${agent.currentAction ? '执行中' : '空闲'}。`);
  parts.push('');
  parts.push('【生存常识】');
  parts.push('- 每人每天大约需要 2 份淡水和 1 份食物；不进食和缺水一样会死。');
  parts.push('- 口渴度低于 50 且我知道水源时，应优先安排取水/喝水。');
  parts.push('- 饥饿度低于 50 且我知道食物地点时，应优先安排采集/进食，而不是继续做无关的事。');
  parts.push('- 库存里有食物且饥饿度低于 60 时，先吃一份再赶路；有水且口渴度低于 60 时同理。');
  parts.push('- 我还没发现食物来源时，探索东南或西南方向更可能找到食物；还没发现水源时，探索东北方向更可能找到淡水。');
  parts.push('- 采集和长途行动消耗体力，体力过低要先休息；身上快没水时，去泉水或公共箱补给。');
  parts.push('- 如果还有未探索的区域，优先探索新区域而不是原地休息或闲聊；体力大于 50 时不要无故休息。');
  parts.push('- 交谈要有具体目的（请求资源、承诺、分享地点、提醒风险）；没有正事时不要反复闲聊。');
  parts.push('');
  parts.push('【我知道的地点】');
  for (const locId of agent.knownLocations) {
    const loc = world.map.locations.find((l) => l.id === locId);
    const node = world.resources[locId];
    parts.push(`- ${locId}（${loc?.name ?? '?'}）${node ? `，剩余${node.stock}/${node.capacity}` : ''}`);
  }
  parts.push('');
  const unexploredZones = world.map.locations
    .filter((l) => l.kind === 'zone' && !agent.exploredZones.includes(l.id))
    .map((l) => l.name);
  if (unexploredZones.length > 0) {
    parts.push('【尚未探索的区域】以下方向我还只是路过，没有仔细探索过；探索它们可能发现食物或水源：');
    parts.push(unexploredZones.map((z) => `- ${z}`).join('\n'));
    parts.push('');
  }
  parts.push('【与他人关系】');
  for (const [otherId, rel] of Object.entries(agent.relationships)) {
    const other = world.agents[otherId];
    parts.push(
      `- ${other.name}：信任${Math.round(rel.trust)}，怨恨${Math.round(rel.resentment)}，依赖${Math.round(rel.dependency)}，亲近${Math.round(rel.affinity)}；对方${other.isAlive ? `在${tileDistText(world, agentId, otherId)}，${other.currentAction ? '正在行动' : '空闲'}` : '已死亡'}`,
    );
  }
  const myPromises = agent.promises.filter((p) => p.status === 'pending');
  if (myPromises.length) {
    parts.push('【我的未兑现承诺】');
    for (const p of myPromises) {
      parts.push(`- 我承诺给${world.agents[p.recipientId]?.name ?? p.recipientId} ${p.amount} ${p.resource ?? ''}，截止${formatGameTime(p.deadline)}。`);
    }
  }
  const pendingToMe = world.promiseLedger.filter((p) => p.recipientId === agentId && p.status === 'pending');
  if (pendingToMe.length) {
    parts.push('【别人对我的承诺】');
    for (const p of pendingToMe) {
      parts.push(`- ${world.agents[p.promiserId]?.name}承诺给我${p.amount} ${p.resource ?? ''}，截止${formatGameTime(p.deadline)}。`);
    }
  }
  parts.push('');
  parts.push('【我最近观察到的关键事件】');
  const events = agent.recentEvents
    .map((eid) => world.events.find((e) => e.eventId === eid))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .slice(-8);
  for (const e of events) {
    parts.push(`- ${formatGameTime(e.gameTime)} ${describeEvent(world, e)}`);
  }
  if (!events.length) parts.push('- 暂无');
  parts.push('');
  parts.push('【可用动作】每个动作的编号、内容与提示：');
  options.forEach((o, i) => parts.push(`【${i}】${o.label}（${o.valueHint}）`));
  parts.push('');
  parts.push(
    '请只输出 JSON：{"actionIndex": 数字, "publicIntent": "一句话说明你要做什么（1句）", "privateMotive": "一句真实动机（1句，不需要长篇推理）", "fallbackActionIndex": 数字}。actionIndex 和 fallbackActionIndex 必须来自上面的可用动作编号。',
  );
  return { prompt: parts.join('\n'), options };
}

function nearestLocationId(world: WorldState, agentId: string): string {
  const agent = world.agents[agentId];
  let best = agent.knownLocations[0] ?? 'crash_camp';
  let bestDist = Infinity;
  for (const locId of agent.knownLocations) {
    const loc = world.map.locations.find((l) => l.id === locId);
    if (!loc) continue;
    const d = Math.abs(loc.position.x - agent.position.x) + Math.abs(loc.position.y - agent.position.y);
    if (d < bestDist) {
      bestDist = d;
      best = locId;
    }
  }
  return best;
}

function tileDistText(world: WorldState, a: string, b: string): string {
  const pa = world.agents[a]?.position;
  const pb = world.agents[b]?.position;
  if (!pa || !pb) return '未知距离';
  const d = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
  return d <= 3 ? `距离${d}格（可交谈/赠予）` : `距离${d}格`;
}

export function describeEvent(
  world: { agents: WorldState['agents']; map: WorldState['map'] },
  e: { type: string; actorId?: string; targetId?: string; locationId?: string; payload?: Record<string, unknown> },
): string {
  const actor = e.actorId ? world.agents[e.actorId]?.name ?? e.actorId : '';
  const target = e.targetId ? world.agents[e.targetId]?.name ?? world.map.locations.find((l) => l.id === e.targetId)?.name ?? e.targetId : '';
  const loc = e.locationId ? world.map.locations.find((l) => l.id === e.locationId)?.name ?? e.locationId : '';
  switch (e.type) {
    case 'resource_given': return `${actor}给了${target}${e.payload?.amount}份${e.payload?.resource === 'water' ? '水' : '食物'}`;
    case 'resource_taken': return `${actor}从${loc}取走${e.payload?.amount}份${e.payload?.resource}`;
    case 'resource_stored': return `${actor}存入公共箱${e.payload?.amount}份${e.payload?.resource}`;
    case 'location_discovered': return `${actor}发现了${loc}`;
    case 'location_shared': return `${actor}把${loc}的位置告诉了${target}`;
    case 'harvest_completed': return `${actor}在${loc}采到${e.payload?.amount}份${e.payload?.resource}`;
    case 'harvest_failed': return `${actor}在${loc}采集失败`;
    case 'promise_fulfilled': return `${actor}兑现了对${target}的承诺`;
    case 'promise_broken': return `${actor}违背了对${target}的承诺`;
    case 'promise_impossible': return `${actor}的承诺（给${target}）因客观原因无法履行`;
    case 'promise_cancelled': return `${actor}取消了对${target}的承诺`;
    case 'agent_died': return `${actor}死亡（${e.payload?.cause}）`;
    case 'message_spoken': return `${actor}对${target}说：${e.payload?.text}`;
    case 'conversation_ended': return `${actor}与${target}结束交谈`;
    case 'action_interrupted': return `${actor}的行动被打断（${e.payload?.reason}）`;
    case 'resource_consumed': return `${actor}消耗了${e.payload?.amount}份${e.payload?.resource}`;
    case 'backpack_looted': return `${actor}拾取了背包（水${e.payload?.water} 食${e.payload?.food}）`;
    case 'explore_completed': return `${actor}探索了${loc}，没有新发现`;
    case 'daily_regen': return '清晨，泉水与潮池恢复';
    default: return `${e.type}${actor ? `（${actor}）` : ''}`;
  }
}

export function parsePlannerOutput(raw: string): { ok: true; output: PlannerOutput } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as Partial<PlannerOutput>;
    if (typeof parsed.actionIndex !== 'number' || !Number.isInteger(parsed.actionIndex) || parsed.actionIndex < 0) {
      return { ok: false, error: 'actionIndex 必须是非负整数' };
    }
    if (typeof parsed.publicIntent !== 'string' || !parsed.publicIntent.trim()) {
      return { ok: false, error: '缺少 publicIntent' };
    }
    if (typeof parsed.privateMotive !== 'string' || !parsed.privateMotive.trim()) {
      return { ok: false, error: '缺少 privateMotive' };
    }
    if (parsed.fallbackActionIndex !== undefined && (typeof parsed.fallbackActionIndex !== 'number' || !Number.isInteger(parsed.fallbackActionIndex) || parsed.fallbackActionIndex < 0)) {
      return { ok: false, error: 'fallbackActionIndex 非法' };
    }
    return {
      ok: true,
      output: {
        actionIndex: parsed.actionIndex,
        publicIntent: parsed.publicIntent.slice(0, 120),
        privateMotive: parsed.privateMotive.slice(0, 160),
        fallbackActionIndex: parsed.fallbackActionIndex,
      },
    };
  } catch {
    return { ok: false, error: 'JSON 解析失败' };
  }
}

export async function planAction(
  world: WorldState,
  agentId: string,
  adapter: LlmAdapter,
  requestId: string,
): Promise<{ intent: ActionIntent | null; record: LlmCallResult; attempts: Array<LlmCallResult> }> {
  const agent = world.agents[agentId];
  const { prompt, options } = buildPlannerContext(world, agentId);
  const attempts: LlmCallResult[] = [];

  const runCall = async (extraInstruction?: string): Promise<LlmCallResult> => {
    const messages = [
      { role: 'system' as const, content: '你是一个严格遵循格式的决策引擎。只输出 JSON，不要输出任何其他文字。' },
      { role: 'user' as const, content: extraInstruction ? `${prompt}\n\n上次输出无效：${extraInstruction}\n请重新输出。` : prompt },
    ];
    const res = await adapter.chat(messages, { jsonMode: true, seed: world.scenario.seed });
    attempts.push(res);
    return res;
  };

  let res = await runCall();
  let parsed = res.content ? parsePlannerOutput(res.content) : { ok: false as const, error: 'empty response' };
  const hasContent = res.content !== null && res.content !== undefined && res.content.length > 0;
  if (!parsed.ok && hasContent && res.status !== 'timeout' && res.status !== '429') {
    // One repair call (21.3).
    const repair = await runCall(`上次输出无法解析：${parsed.error}。请只输出合法 JSON。`);
    res = repair;
    if (repair.content) {
      const reparsed = parsePlannerOutput(repair.content);
      if (reparsed.ok) parsed = reparsed;
    }
  }

  if (!parsed.ok) {
    return { intent: null, record: res, attempts };
  }

  const out = parsed.output;
  const chosen = options[out.actionIndex];
  const fallback = out.fallbackActionIndex !== undefined ? options[out.fallbackActionIndex] : undefined;
  const intent: ActionIntent = {
    requestId,
    actorId: agentId,
    snapshotVersion: world.worldVersion,
    requestedGameTime: world.gameTime,
    action: chosen ? chosen.action : safeFallbackAction(options),
    publicIntent: out.publicIntent,
    privateMotive: out.privateMotive,
    fallback: fallback ? fallback.action : undefined,
  };
  // If chosen index invalid, treat as invalid and use safe fallback.
  if (!chosen) {
    agent.invalidActionStreak += 1;
    agent.lastInvalidAction = `actionIndex ${out.actionIndex} 越界`;
  }
  return { intent, record: res, attempts };
}

function safeFallbackAction(options: ActionOption[]): Action {
  const rest = options.find((o) => /休息/.test(o.label));
  if (rest) return rest.action;
  return { type: 'rest', durationMinutes: 60 };
}
