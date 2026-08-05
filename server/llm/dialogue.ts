// Short dialogue generation with structured speech acts (PRD 9.1/9.2, SOC-001/002).

import { getProfile, promptSelfDescription } from '../engine/profile';
import { formatGameTime } from '../engine/scenario';
import { describeEvent } from './planner';
import { LlmAdapter, type LlmCallResult } from './adapter';
import type { Conversation, SpeechAct, SpeechActType, WorldState } from '../engine/types';

export type DialogueOutput = {
  initiatorMessage: SpeechAct;
  responderMessages: SpeechAct[];
};

const WHITELIST: SpeechActType[] = [
  'request_resource',
  'offer_trade',
  'promise',
  'share_location',
  'warn',
  'accuse',
  'threaten',
  'social_chat',
  'accept_request',
  'reject_request',
  'cancel_promise',
];

export function buildDialoguePrompt(world: WorldState, conv: Conversation, initiatorIntent: string): string {
  const [iid, rid] = conv.participants;
  const initiator = world.agents[iid];
  const responder = world.agents[rid];
  const ip = getProfile(iid);
  const rp = getProfile(rid);
  const parts: string[] = [];
  parts.push('【系统】你在生成荒岛角色之间的一次简短中文对话（10-25个岛上分钟）。双方各说1条消息（回应方最多2条）。消息必须带结构化意图类型。只有结构化字段会改变游戏状态；纯文本不会转移资源或知识。');
  parts.push('');
  parts.push(`【发起方】${initiator.name}（${ip.title}）`);
  parts.push(promptSelfDescription(ip));
  parts.push(
    `状态：口渴${Math.round(initiator.needs.water)} 饥饿${Math.round(initiator.needs.food)} 体力${Math.round(initiator.needs.stamina)}；库存 水${initiator.inventory.water} 食${initiator.inventory.food}；`,
  );
  parts.push(`他知道的地点：${initiator.knownLocations.join('、')}`);
  parts.push(`他对${responder.name}的信任：${Math.round(initiator.relationships[rid]?.trust ?? 0)}，怨恨：${Math.round(initiator.relationships[rid]?.resentment ?? 0)}`);
  if (initiatorIntent) parts.push(`发起方想做的事：${initiatorIntent}`);
  parts.push('');
  parts.push(`【回应方】${responder.name}（${rp.title}）`);
  parts.push(promptSelfDescription(rp));
  parts.push(
    `状态：口渴${Math.round(responder.needs.water)} 饥饿${Math.round(responder.needs.food)} 体力${Math.round(responder.needs.stamina)}；库存 水${responder.inventory.water} 食${responder.inventory.food}；`,
  );
  parts.push(`他知道的地点：${responder.knownLocations.join('、')}`);
  parts.push(`他对${initiator.name}的信任：${Math.round(responder.relationships[iid]?.trust ?? 0)}，怨恨：${Math.round(responder.relationships[iid]?.resentment ?? 0)}`);
  parts.push('');
  parts.push('【相关背景】');
  const relEvents = initiator.recentEvents
    .map((eid) => world.events.find((e) => e.eventId === eid))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .slice(-6);
  for (const e of relEvents) parts.push(`- ${formatGameTime(e.gameTime)} ${describeEvent(world, e)}`);
  const pending = world.promiseLedger.filter(
    (p) => (p.promiserId === iid && p.recipientId === rid) || (p.promiserId === rid && p.recipientId === iid),
  );
  for (const p of pending) {
    parts.push(`- 承诺记录：${world.agents[p.promiserId]?.name}承诺给${world.agents[p.recipientId]?.name} ${p.amount ?? ''} ${p.resource ?? '地点信息'}，截止${formatGameTime(p.deadline)}，状态${p.status}`);
  }
  parts.push('');
  parts.push('【可用结构化意图类型】request_resource（请求资源）, offer_trade（提议交换）, promise（承诺）, share_location（告知地点）, warn（提醒）, accuse（指责）, threaten（威胁）, social_chat（闲聊）, accept_request（接受请求）, reject_request（拒绝请求）, cancel_promise（取消承诺）。');
  parts.push('【对话规则】');
  parts.push('- 只有真正想做的才用相应类型；request_resource 必须给出 resource 和 amount；promise 必须给出 resource、amount 和 deadline（游戏时间，格式 dayX-HH:MM）；share_location 必须给出你知道的 locationId。');
  parts.push('- 回应方根据自身状态决定接受、拒绝、讨价还价或转移话题。拒绝时用 reject_request 并简短说明。');
  parts.push(`- 当前游戏时间：${formatGameTime(world.gameTime)}。`);
  parts.push(
    '请只输出 JSON：{"initiatorMessage": {"type": "...", "text": "..."}, "responderMessages": [{"type": "...", "text": "...", "resource"?: "...", "amount"?: 数字, "locationId"?: "...", "deadline"?: "dayX-HH:MM"}]}',
  );
  return parts.join('\n');
}

export function parseDialogueOutput(raw: string): { ok: true; output: DialogueOutput } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as Partial<DialogueOutput>;
    const initiatorMessage = parsed.initiatorMessage;
    const responderMessages = parsed.responderMessages;
    if (!initiatorMessage || typeof initiatorMessage.type !== 'string' || !WHITELIST.includes(initiatorMessage.type as SpeechActType)) {
      return { ok: false, error: 'initiatorMessage 意图类型非法' };
    }
    if (!Array.isArray(responderMessages) || responderMessages.length === 0 || responderMessages.length > 2) {
      return { ok: false, error: 'responderMessages 需要 1-2 条' };
    }
    for (const m of responderMessages) {
      if (!m || typeof m.type !== 'string' || !WHITELIST.includes(m.type as SpeechActType)) {
        return { ok: false, error: 'responderMessages 意图类型非法' };
      }
    }
    const clean = (m: SpeechAct): SpeechAct => ({
      type: m.type as SpeechActType,
      text: (m.text ?? '').slice(0, 200),
      resource: m.resource === 'water' || m.resource === 'food' ? m.resource : undefined,
      amount: typeof m.amount === 'number' && m.amount > 0 ? Math.min(m.amount, 5) : undefined,
      locationId: typeof m.locationId === 'string' ? m.locationId.slice(0, 40) : undefined,
      promiseId: typeof m.promiseId === 'string' ? m.promiseId : undefined,
      deadline: m.deadline,
    });
    return {
      ok: true,
      output: {
        initiatorMessage: clean(initiatorMessage),
        responderMessages: responderMessages.map(clean),
      },
    };
  } catch {
    return { ok: false, error: 'JSON 解析失败' };
  }
}

export async function generateDialogue(
  world: WorldState,
  conv: Conversation,
  initiatorIntent: string,
  adapter: LlmAdapter,
  requestId: string,
): Promise<{ output: DialogueOutput | null; results: LlmCallResult[] }> {
  const prompt = buildDialoguePrompt(world, conv, initiatorIntent);
  const results: LlmCallResult[] = [];
  let res = await adapter.chat(
    [
      { role: 'system', content: '你是一个严格遵循格式的对话生成引擎。只输出 JSON。' },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true, seed: world.scenario.seed, maxTokens: 900 },
  );
  results.push(res);
  let parsed = res.content ? parseDialogueOutput(res.content) : { ok: false as const, error: 'empty' };
  if (!parsed.ok && res.status === 'ok') {
    const repair = await adapter.chat(
      [
        { role: 'system', content: '你是一个严格遵循格式的对话生成引擎。只输出 JSON。' },
        { role: 'user', content: `${prompt}\n\n上次输出无效：${parsed.error}。请重新输出合法 JSON。` },
      ],
      { jsonMode: true, seed: world.scenario.seed, maxTokens: 900 },
    );
    res = repair;
    results.push(res);
    if (repair.content) {
      const reparsed = parseDialogueOutput(repair.content);
      if (reparsed.ok) parsed = reparsed;
    }
  }
  void requestId;
  if (!parsed.ok) return { output: null, results };
  return { output: parsed.output, results };
}
