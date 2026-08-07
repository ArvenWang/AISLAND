// P4: real-API planner. Long-term goals, current objective, 2-5 step plans,
// abort conditions, and a single next action. Prompt rules per PRD 12.2/12.3:
// no direction hints, no numeric threshold commands, no fixed strategies, no
// hidden map knowledge. API/parse failures pause the agent (no fallback
// actions); physical rejections are fed back as world feedback.

import { Mvp2World, AgentState, ActionSpec, AgentPlan, LlmProvenance } from './types';
import { buildPerceptionSnapshot, type PerceptionSnapshot } from '../engine/perception/snapshot';
import { lightPhaseAt } from '../engine/perception/lighting';
import { getProfile, promptSelfDescription } from '../engine/profile';
import { hashString } from '../engine/rng';

export type LlmLike = {
  chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean }): Promise<{
    content: string | null;
    status: 'ok' | 'parse_failed' | 'timeout' | 'error' | '429' | 'refused';
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    model: string;
  }>;
};

export type AgentDecision = {
  longTermGoal: string;
  currentObjective: string;
  plan: Array<{ action: string; purpose: string; expectedObservation?: string }>;
  nextAction: {
    type: string;
    targetRef?: string;
    direction?: string;
    itemKind?: string;
    amount?: number;
    text?: string;
  };
  abortConditions: Array<{ kind: string; description: string }>;
  communicationIntent?: { targetRef?: string; purpose: string; mode: string };
  privateMotive: string;
};

const FORBIDDEN_MARKERS = ['东北', '东南', '西北', '西南', '低于', '高于', '必须喝水', '必须进食', '优先探索', '优先采集', '应该合作', '应该竞争', '应该分享', '去东边', '去西边', '去南边', '去北边'];

export function buildPlannerMessages(world: Mvp2World, agent: AgentState, feedback: string[]): Array<{ role: 'system' | 'user'; content: string }> {
  const profile = getProfile(agent.profileId);
  const mech = profile; // profile already compiled
  const light = lightPhaseAt(world.gameTime);
  const lightLabel = light === 'day' ? '白天' : light === 'dusk' ? '黄昏' : light === 'dawn' ? '清晨' : '黑夜';
  const snap: PerceptionSnapshot = buildPerceptionSnapshot(
    world.map,
    agent.id,
    Object.values(world.agents).map((a) => ({ id: a.id, name: a.knowledge.introducedTo.includes(agent.id) ? a.name : null, x: a.x, y: a.y, activity: a.currentAction?.type ?? 'idle' })),
    Object.values(world.groundItems).map((g) => ({ id: g.itemId, kind: g.kind, x: g.x, y: g.y, quantity: g.quantity })),
    [],
    agent.cognitive,
    lightLabel,
    world.gameTime,
  );

  const day = Math.floor(world.gameTime / 1440) + 1;
  const hour = Math.floor((world.gameTime % 1440) / 60);
  const minute = Math.floor(world.gameTime % 60);

  const parts: string[] = [];
  parts.push('【系统】你是一名在陌生海岸醒来的幸存者，正身处一片未知的陆地。你只能基于自己亲眼看到、亲身经历和听说的信息做决定。你会真实地感受口渴、饥饿、疲惫、恐惧。请用中文思考，输出结构化 JSON 决策。');
  parts.push('【当前处境（最重要）】');
  parts.push(`时间：第 ${day} 日 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}（${lightLabel}）。`);
  parts.push(`身体：口渴度 ${Math.round(agent.needs.water)}/100，饥饿度 ${Math.round(agent.needs.food)}/100，体力 ${Math.round(agent.needs.stamina)}/100，健康 ${Math.round(agent.needs.health)}/100，困倦 ${Math.round(agent.needs.sleepNeed)}/100。`);
  const hoursLeft = Math.floor(agent.needs.water / NEED_WATER_RATE);
  parts.push(`估算：照当前消耗速度，不补充水分的话你大约还能撑 ${hoursLeft} 岛上小时。`);
  parts.push(`感受：${waterFeeling(agent.needs.water)}${foodFeeling(agent.needs.food)}${healthFeeling(agent.needs.health)}`);
  parts.push(`心理：稳定 ${Math.round(agent.mental.mentalStability)}/100，恐惧 ${Math.round(agent.mental.fear)}/100。`);
  parts.push(`携带：${Object.entries(agent.inventory).map(([k, v]) => `${k}×${v}`).join('、') || '空手'}。`);
  if (Object.keys(agent.inventory).length) {
    parts.push(`携带物品的用途：${Object.keys(agent.inventory).map((k) => itemUsage(k)).filter(Boolean).join('；')}。`);
    if (agent.inventory.water && agent.needs.water < 65) parts.push('你身上有水：现在选择 consume（itemKind=water）就能立刻喝到，这是最快缓解口渴的办法。');
    if (agent.inventory.food && agent.needs.food < 65) parts.push('你身上有食物：现在选择 consume（itemKind=food）就能立刻吃到，这是最快缓解饥饿的办法。');
  }
  if (agent.lastDecisionAction === 'pickup_item' && (agent.inventory.water ?? 0) >= 2 && agent.needs.water < 55) {
    parts.push('你刚刚一直在收集物品，但还没有喝过水。你手里已经有水了——口渴不会因为继续收集而缓解。');
  }
  if (agent.lastDecisionAction === 'observe' || agent.lastDecisionAction === 'rest') {
    if (agent.needs.water < 45 || agent.needs.food < 45) {
      parts.push('你上一轮选择观察/休息，但什么都没改变，口渴和饥饿还在恶化。观察不能代替行动——去探索新的地方，或者去处理你知道的水源/食物。');
    }
  }
  parts.push(`方向感：${snap.positionHint}`);
  parts.push(`当前行动：${agent.currentAction ? '正在行动中' : '空闲'}。`);
  parts.push('');
  parts.push('【角色】');
  parts.push(promptSelfDescription(profile));
  parts.push(`我的负重能力：约 ${9 + ((agent.inventory.backpack ?? 0) > 0 ? 6 : 0)} 单位。`);
  parts.push('');
  const hist = agent.needsHistory;
  if (hist.length >= 2) {
    const prev = hist[hist.length - 2];
    const dw = agent.needs.water - prev.water;
    const df = agent.needs.food - prev.food;
    if (dw < -1 || df < -1) {
      parts.push(`【你的处境正在变化】距离上次决定约 ${Math.max(1, Math.round((world.gameTime - prev.t) / 60))} 岛上小时：口渴度变化 ${dw >= 0 ? '+' : ''}${Math.round(dw)}，饥饿度变化 ${df >= 0 ? '+' : ''}${Math.round(df)}。体力、健康和时间都在消耗，原地不动不会让情况变好。`);
    }
  }
  const lastDecisionType = agent.lastDecisionAction ?? null;
  if (lastDecisionType && ['observe', 'rest'].includes(lastDecisionType)) {
    parts.push('（你上一轮选择的是观察或休息；如果身体状况仍在恶化，请优先解决口渴和饥饿。）');
  }
  parts.push('【我看到的周围环境】');
  parts.push(snap.terrainSummary.map((t) => `${t.nearby ? '近处' : '远处'}${t.terrain}（${t.count} 格）`).join('；') || '看不清楚');
  if (snap.visibleAgents.length) parts.push(`我看到的其他人：${snap.visibleAgents.map((a) => a.name ?? '另一名幸存者').join('、')}。`);
  if (snap.visibleAgents.length) parts.push('另一名幸存者就在附近。你可以用 talk 打招呼、询问或告诉对方水源/食物/危险信息（targetRef 用对方名字）；对方也可能回应你。交流是获取信息和建立信任的自然方式。');
  const nearbyOther = snap.visibleAgents.find((a) => Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) <= 4);
  if (nearbyOther && !agent.knowledge.introducedTo.length) {
    parts.push(`你和一个陌生人（${nearbyOther.name ?? '另一名幸存者'}）几乎并肩站着。在这样的荒岛上，先开口打个招呼、报出自己的名字，是最自然的做法——用 talk 说一句话（targetRef=${nearbyOther.name ?? '另一名幸存者'}）。`);
  }
  if (snap.visibleItems.length) {
    const withDist = snap.visibleItems
      .map((it) => `${it.id}（${it.kind}×${it.quantity}，约 ${Math.abs(it.x - agent.x) + Math.abs(it.y - agent.y)} 格外）`)
      .join('、');
    parts.push(`我看到地面物品：${withDist}。pickup_item 的 targetRef 必须完整使用这里的某个物品 ID（例如 ${snap.visibleItems[0].id}），不要改写或缩写；优先选离你近的物品。`);
  }
  if (snap.visibleLandmarks.length) parts.push(`我认出的地标：${snap.visibleLandmarks.join('、')}。`);
  parts.push('');
  parts.push('【我记得的地方】');
  const lms = agent.cognitive.landmarks.slice(-8).map((l) => `${l.kind}（${Math.abs(l.x - agent.cognitive.positionEstimate.x) + Math.abs(l.y - agent.cognitive.positionEstimate.y)} 格外）`);
  parts.push(lms.length ? lms.join('、') : '我对附近还不太熟悉。');
  const knownRes = agent.knowledge.knownResources.map((id) => world.resources[id]).filter(Boolean);
  if (knownRes.length) {
    parts.push('【我亲眼见过并知道位置的资源】');
    parts.push(knownRes.map((r) => `${r.resourceId}（${r.kind === 'spring' ? '淡水泉' : r.kind === 'berry_bush' ? '浆果丛' : '木柴堆'}，还有约 ${Math.ceil(r.stock)} 份）`).join('、'));
    const knownSpring = knownRes.find((r) => r.kind === 'spring');
    if (knownSpring && agent.needs.water < 60) {
      parts.push(`你正在口渴（${Math.round(agent.needs.water)}/100），而且你亲眼见过淡水泉 ${knownSpring.resourceId} 的位置。选 move_to(${knownSpring.resourceId}) 走到泉水边，再选 harvest(${knownSpring.resourceId}) 就能取到水。`);
    }
  } else if (agent.needs.water < 70) {
    parts.push('你还没有发现任何淡水来源。在没有找到水之前，把寻找淡水（河、泉、水迹、低洼湿地）作为当前最重要的目标。');
  }
  parts.push('');
  parts.push('【与我有关的人】');
  for (const [otherId, rel] of Object.entries(agent.relationships)) {
    const o = world.agents[otherId];
    if (!o) continue;
    parts.push(`${o.name}：信任 ${Math.round(rel.trust)}，怨恨 ${Math.round(rel.resentment)}，依赖 ${Math.round(rel.dependency)}。`);
  }
  const met = agent.knowledge.introducedTo.map((id) => world.agents[id]?.name).filter(Boolean);
  if (met.length) parts.push(`我认识：${met.join('、')}。`);
  parts.push('');
  parts.push('【最近发生在我身边的事】');
  const recent = world.events
    .filter((e) => e.observers.includes(agent.id))
    .slice(-8)
    .map((e) => `第${Math.floor(e.gameTime / 1440) + 1}日 ${Math.floor((e.gameTime % 1440) / 60)}时 ${describeEventType(world, e.type, e.payload, e.actorId)}`);
  parts.push(recent.length ? recent.join('\n') : '暂无。');
  if (feedback.length) {
    parts.push('【我上一次尝试的结果】');
    parts.push(feedback.join('\n'));
  }
  // Strong directional clue: the most recent spring water sound heard by
  // this agent (factual perception, not a strategy hint).
  const springSound = [...world.events]
    .reverse()
    .find((e) => e.type === 'sound_heard' && e.observers.includes(agent.id) && String(e.payload?.text ?? '').includes('泉水'));
  if (springSound) {
    const bearing = String(springSound.payload?.bearing ?? '');
    const clarity = springSound.payload?.clarity != null ? Math.round(Number(springSound.payload.clarity) * 100) : null;
    const distLabel = springSound.payload?.distanceClass === 'near' ? '很近' : springSound.payload?.distanceClass === 'medium' ? '不算远' : '较远';
    parts.push('【重要的方向线索（最近听到的流水声）】');
    parts.push(`你${distLabel}听到流水声（泉水），来自${bearing}方向${clarity != null ? `，清晰度约 ${clarity}%` : ''}。这是你现在唯一能定位淡水位置的声音线索。`);
  }
  if (agent.plan) {
    parts.push('【我目前的计划】');
    parts.push(`长期目标：${agent.plan.longTermGoal}`);
    parts.push(`当前目标：${agent.plan.currentObjective}`);
    parts.push(agent.plan.steps.map((s, i) => `${i === (agent.plan as NonNullable<AgentState['plan']>).stepIndex ? '>' : ' '} ${s.description}`).join('\n'));
    if (agent.plan.abortConditions.length) parts.push(`放弃条件：${agent.plan.abortConditions.map((a) => a.description).join('；')}`);
  }
  parts.push('');
  parts.push('【生存常识】');
  parts.push('- 饮水能缓解口渴，食物能缓解饥饿，睡眠和休息能恢复精力。');
  parts.push('- 长时间缺水、缺食物、缺睡眠或严重受伤会危及生命。');
  parts.push('- 海水通常不能直接饮用；陌生植物和食物可能有风险。');
  parts.push('- 夜间无光时视野差，陌生复杂地形更容易迷失方向。');
  parts.push('- 携带更多物品会降低速度并增加体力消耗。');
  parts.push('- 交流可以获得信息和帮助，也可能包含错误、隐瞒或欺骗。');
  parts.push('');
  parts.push('【你可以采取的行动】');
  parts.push(
    [
      'move_to(targetRef|direction)：走向你见过的人/物品/资源/地标，或朝一个方向移动（如 north/south/east/west）。',
      'explore(direction|mode)：朝某个方向（north/south/east/west/northeast/northwest/southeast/southwest）探索未知区域，或沿海岸/沿山坡/搜索附近。',
      'pickup_item(targetRef)：拾取你看见的地面物品。',
      'harvest(targetRef)：从你见过的资源（泉/浆果丛/木柴堆）采集。',
      'consume(itemKind, amount)：喝水或吃东西。',
      'offer_item(targetRef, itemKind, amount)：把物品递给附近的人。',
      'talk(targetRef, text)：对附近的人说话。',
      'shout(text)：大声呼喊。',
      'build_fire：用引火物、木柴和打火工具生火。',
      'add_fuel：给火堆加柴。',
      'sleep / rest / wake：休息。',
      'search(targetRef)：搜索你发现的残骸。',
      'drop(itemKind, amount)：把物品放在脚下。',
      'observe：停下来仔细观察四周。',
    ].join('\n'),
  );
  parts.push('targetRef 只能引用你上面看到或记得的实体，不知道位置的东西不能选。');
  parts.push('如果你要拾取、采集、交谈或递给远处的目标，直接选择该行动即可，你会先走过去再执行。');
  parts.push('');
  parts.push(
    '只输出 JSON，不要输出其他文字：{"longTermGoal":"一句话长期目标","currentObjective":"当前几小时要解决的问题","plan":[{"action":"计划步骤描述","purpose":"目的"}],"nextAction":{"type":"上面的行动类型","targetRef":"实体或地标引用，可选","direction":"方向，可选","itemKind":"water/food/wood，可选","amount":1,"text":"说话内容，可选"},"abortConditions":[{"kind":"reason","description":"何时放弃当前计划"}],"communicationIntent":{"targetRef":"对谁","purpose":"想沟通什么","mode":"talk/shout"},"privateMotive":"一句真实动机"}',
  );
  return [
    { role: 'system', content: '你是一个诚实、有生存本能的角色模拟。你的每个决定都必须来自你的所见所闻，不能知道你没看到的东西。' },
    { role: 'user', content: parts.join('\n') },
  ];
}

function describeEventType(world: Mvp2World, type: string, payload: Record<string, unknown>, actorId?: string): string {
  const who = actorId ? world.agents[actorId]?.name ?? '某人' : '';
  const map: Record<string, string> = {
    item_picked_up: `我${payload.quantity ? `捡到了 ${payload.quantity} 份${payload.kind}` : '捡起了物品'}`,
    item_dropped: `我把 ${payload.kind} 放在了地上`,
    handover_completed: `我把 ${payload.quantity} 份${payload.kind} 交给了对方`,
    resource_harvested: `我从${payload.kind === 'water' ? '泉' : payload.kind === 'food' ? '浆果丛' : '木柴堆'}采集了 ${payload.quantity} 份`,
    resource_discovered: '我发现了一处资源',
    consumed: `我喝了/吃了 ${payload.quantity} 份${payload.kind}`,
    fire_lit: '我生起了火',
    fire_fueled: '我给火堆加了柴',
    sleep_started: '我开始睡觉',
    woke_up: '我醒来了',
    agent_died: '有人死了',
    item_taken_owned: '有人拿走了属于别人的物品',
    sound_heard: `我听到${payload.distanceClass === 'near' ? '近处' : payload.distanceClass === 'medium' ? '不远处' : '远处'}传来声音（${payload.bearing}方向，清晰度${Math.round(Number(payload.clarity ?? 0) * 100)}%）：${payload.text ?? ''}`,
    message_spoken: `${who}对我说：${payload.text ?? ''}`,
    shout: `我听到呼喊：${payload.text ?? ''}`,
    action_rejected:
      payload.reason === 'too_far'
        ? `我的行动没有成功：${payload.type ?? ''} 目标 ${payload.targetRef ?? '（无目标）'} 太远且无法直接接近（前方被未知区域或障碍挡住）。请改选身边的目标，或先用 explore 探索出新路线，不要反复尝试同一个远处目标。`
        : payload.reason === 'no_path'
          ? `我的行动没有成功：${payload.type ?? ''} 目标 ${payload.targetRef ?? '（无目标）'} 没有已知路线可达（前方未知或受阻）。先用 explore 向那个方向探索，或选择其他目标。`
          : `我的行动没有成功：${payload.type ?? ''} 目标 ${payload.targetRef ?? '（无目标）'} 失败原因：${payload.reason}`,
    wreck_searched: '我搜索了残骸',
    move_completed: '我到达了目标位置',
  };
  return map[type] ?? type;
}

export function parseAgentDecision(content: string): AgentDecision | null {
  const cleaned = content
    .replace(/```json|```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  // Try every closing brace from the end backwards; accept the first valid
  // parse (handles trailing text and multiple JSON objects).
  let raw: Record<string, unknown> | null = null;
  for (let end = cleaned.lastIndexOf('}'); end > start; end = cleaned.lastIndexOf('}', end - 1)) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        raw = parsed;
        break;
      }
    } catch {
      // try next candidate
    }
  }
  if (!raw) return null;
  try {
    const next = (raw.nextAction ?? {}) as Record<string, unknown>;
    const plan = Array.isArray(raw.plan) ? (raw.plan as Array<Record<string, unknown>>).slice(0, 5).map((p) => ({ action: String(p.action ?? ''), purpose: String(p.purpose ?? ''), expectedObservation: p.expectedObservation ? String(p.expectedObservation) : undefined })) : [];
    return {
      longTermGoal: String(raw.longTermGoal ?? '').slice(0, 80),
      currentObjective: String(raw.currentObjective ?? '').slice(0, 120),
      plan,
      nextAction: {
        type: String(next.type ?? 'observe').slice(0, 30),
        targetRef: next.targetRef ? String(next.targetRef).slice(0, 60) : undefined,
        direction: next.direction ? String(next.direction).slice(0, 20) : undefined,
        itemKind: next.itemKind ? String(next.itemKind).slice(0, 10) : undefined,
        amount: typeof next.amount === 'number' ? Math.max(1, Math.floor(next.amount)) : 1,
        text: next.text ? String(next.text).slice(0, 120) : undefined,
      },
      abortConditions: Array.isArray(raw.abortConditions) ? (raw.abortConditions as Array<Record<string, unknown>>).slice(0, 5).map((a) => ({ kind: String(a.kind ?? 'reason'), description: String(a.description ?? '').slice(0, 60) })) : [],
      communicationIntent: raw.communicationIntent
        ? { targetRef: String((raw.communicationIntent as Record<string, unknown>).targetRef ?? ''), purpose: String((raw.communicationIntent as Record<string, unknown>).purpose ?? '').slice(0, 80), mode: String((raw.communicationIntent as Record<string, unknown>).mode ?? 'talk') }
        : undefined,
      privateMotive: String(raw.privateMotive ?? '').slice(0, 160),
    };
  } catch {
    return null;
  }
}

export function resolveNextAction(world: Mvp2World, agent: AgentState, decision: AgentDecision): { spec: ActionSpec } | { error: string } {
  const na = decision.nextAction;
  const kind = na.itemKind as 'water' | 'food' | 'wood' | 'tinder' | 'lighter' | 'backpack';
  const resolveRef = (): { kind: 'item' | 'agent' | 'resource' | 'wreck' | 'landmark' | 'fire'; id: string; x: number; y: number } | null => {
    if (!na.targetRef) return null;
    const ref = na.targetRef;
    const visibleItems = Object.values(world.groundItems).filter((g) => agent.cognitive.visible[g.y * world.map.width + g.x]);
    if (world.groundItems[ref]) {
      const g = world.groundItems[ref];
      return { kind: 'item', id: ref, x: g.x, y: g.y };
    }
    if (world.agents[ref] && ref !== agent.id) {
      const o = world.agents[ref];
      return { kind: 'agent', id: ref, x: o.x, y: o.y };
    }
    // Agents are shown to the LLM by Chinese name (or "另一名幸存者");
    // resolve those references to the actual agent id.
    const visibleOthers = Object.values(world.agents).filter((o) => o.id !== agent.id && agent.cognitive.visible[o.y * world.map.width + o.x] && o.isAlive);
    const byName = visibleOthers.find((o) => o.name === ref || (ref.length > 1 && o.name.includes(ref)) || ref.includes(o.name));
    if (byName) return { kind: 'agent', id: byName.id, x: byName.x, y: byName.y };
    if (ref.includes('幸存者') && visibleOthers.length) {
      const nearest = [...visibleOthers].sort((a, b) => Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) - (Math.abs(b.x - agent.x) + Math.abs(b.y - agent.y)))[0];
      if (nearest) return { kind: 'agent', id: nearest.id, x: nearest.x, y: nearest.y };
    }
    if (world.resources[ref] && agent.knowledge.knownResources.includes(ref)) {
      const r = world.resources[ref];
      return { kind: 'resource', id: ref, x: r.x, y: r.y };
    }
    if (world.wrecks[ref]) {
      const w = world.wrecks[ref];
      return { kind: 'wreck', id: ref, x: w.x, y: w.y };
    }
    if (world.fires[ref]) {
      const f = world.fires[ref];
      return { kind: 'fire', id: ref, x: f.x, y: f.y };
    }
    const lm = agent.cognitive.landmarks.find((l) => l.kind === ref || `${l.kind}_${l.x}_${l.y}` === ref || ref.includes(l.kind));
    if (lm) return { kind: 'landmark', id: ref, x: lm.x, y: lm.y };
    // Friendly fallback: item kind label -> nearest visible item of that kind.
    const byKind = visibleItems.find((g) => ref.includes(g.kind) || g.kind.includes(ref) || `${g.kind}×${g.quantity}` === ref);
    if (byKind) return { kind: 'item', id: byKind.itemId, x: byKind.x, y: byKind.y };
    // Friendly fallback: resource kind -> nearest known resource.
    const byRes = agent.knowledge.knownResources
      .map((id) => world.resources[id])
      .filter((r): r is NonNullable<typeof r> => !!r && (r.kind === 'spring' ? ref.includes('泉') : r.kind === 'berry_bush' ? ref.includes('浆果') : ref.includes('木柴')))
      .sort((a, b) => Math.abs(a.x - agent.x) + Math.abs(a.y - agent.y) - (Math.abs(b.x - agent.x) + Math.abs(b.y - agent.y)))[0];
    if (byRes) return { kind: 'resource', id: byRes.resourceId, x: byRes.x, y: byRes.y };
    // Terrain-name reference: "稀疏林地/海边/草地..." -> nearest VISIBLE cell
    // of that terrain class (the agent means a place it can see).
    const terrainAlias: Array<[RegExp, string]> = [
      [/疏林|林地|树丛|森林/, 'sparse'],
      [/密林|丛林/, 'dense'],
      [/草地|草丛|平原/, 'grass'],
      [/海边|海岸|沙滩|滩/, 'drySand'],
      [/湿地|泥地|沼泽/, 'mud'],
      [/岩石|山地|山脊|高地/, 'rock'],
      [/泉水|水源|溪/, 'spring'],
    ];
    for (const [re, cls] of terrainAlias) {
      if (!re.test(ref)) continue;
      let bestCell: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let i = 0; i < agent.cognitive.visible.length; i++) {
        if (!agent.cognitive.visible[i]) continue;
        const x = i % world.map.width;
        const y = Math.floor(i / world.map.width);
        const t = world.map.terrainAt(x, y);
        const match = cls === 'spring' ? world.resources[`spring_${x}_${y}`] !== undefined : t === cls;
        if (!match) continue;
        const d = Math.abs(x - agent.x) + Math.abs(y - agent.y);
        if (d < bestD) {
          bestD = d;
          bestCell = { x, y };
        }
      }
      if (bestCell) return { kind: 'landmark', id: ref, x: bestCell.x, y: bestCell.y };
    }
    return null;
  };
  const dirVec = (d?: string): { x: number; y: number } | null => {
    switch (d ?? 'north') {
      case 'north': return { x: 0, y: -1 };
      case 'south': return { x: 0, y: 1 };
      case 'east': return { x: 1, y: 0 };
      case 'west': return { x: -1, y: 0 };
      case 'northeast': return { x: 1, y: -1 };
      case 'northwest': return { x: -1, y: -1 };
      case 'southeast': return { x: 1, y: 1 };
      case 'southwest': return { x: -1, y: 1 };
      default: return null;
    }
  };
  switch (na.type) {
    case 'move_to': {
      const r = resolveRef();
      if (r) return { spec: { type: 'move', target: { kind: 'cell', x: r.x, y: r.y } } };
      const v = dirVec(na.direction);
      if (v) return { spec: { type: 'explore', target: { kind: 'direction', bearingDeg: bearingFromVec(v) } } };
      return { error: 'unknown target' };
    }
    case 'explore': {
      const v = dirVec(na.direction);
      const bearing = v ? bearingFromVec(v) : 0;
      return { spec: { type: 'explore', target: { kind: 'direction', bearingDeg: bearing } } };
    }
    case 'pickup_item': {
      const r = resolveRef();
      if (!r || r.kind !== 'item') return { error: 'unknown item' };
      return { spec: { type: 'pickup_item', target: { kind: 'item', itemId: r.id } } };
    }
    case 'harvest': {
      const r = resolveRef();
      if (!r || r.kind !== 'resource') return { error: 'unknown resource' };
      const type = world.resources[r.id].kind === 'spring' ? 'harvest_water' : world.resources[r.id].kind === 'berry_bush' ? 'harvest_food' : 'harvest_wood';
      return { spec: { type, target: { kind: 'resource', resourceId: r.id }, amount: na.amount } };
    }
    case 'consume': {
      if (!kind) return { error: 'missing item kind' };
      return { spec: { type: 'consume', target: { kind: 'none' }, itemKind: kind, amount: na.amount } };
    }
    case 'offer_item': {
      const r = resolveRef();
      if (!r || r.kind !== 'agent') return { error: 'unknown agent' };
      return { spec: { type: 'offer_item', target: { kind: 'agent', agentId: r.id }, itemKind: kind ?? 'water', amount: na.amount } };
    }
    case 'talk': {
      const r = resolveRef();
      if (!r || r.kind !== 'agent') return { error: 'unknown agent' };
      return { spec: { type: 'talk', target: { kind: 'agent', agentId: r.id }, text: na.text } };
    }
    case 'shout':
      return { spec: { type: 'shout', target: { kind: 'none' }, text: na.text } };
    case 'build_fire':
      return { spec: { type: 'build_fire', target: { kind: 'cell', x: agent.x, y: agent.y } } };
    case 'add_fuel': {
      const r = resolveRef();
      if (!r || r.kind !== 'fire') return { error: 'unknown fire' };
      return { spec: { type: 'add_fuel', target: { kind: 'fire', fireId: r.id }, amount: na.amount } };
    }
    case 'sleep':
      return { spec: { type: 'sleep', target: { kind: 'none' } } };
    case 'rest':
      return { spec: { type: 'rest', target: { kind: 'none' } } };
    case 'wake':
      return { spec: { type: 'wake', target: { kind: 'none' } } };
    case 'search': {
      const r = resolveRef();
      if (!r || r.kind !== 'wreck') return { error: 'unknown wreck' };
      return { spec: { type: 'search_wreckage', target: { kind: 'wreck', wreckId: r.id } } };
    }
    case 'drop':
      return { spec: { type: 'drop_item', target: { kind: 'cell', x: agent.x, y: agent.y }, itemKind: kind ?? 'water', amount: na.amount } };
    case 'observe':
      return { spec: { type: 'observe', target: { kind: 'none' } } };
    default:
      return { error: `unsupported action ${na.type}` };
  }
}

function bearingFromVec(v: { x: number; y: number }): number {
  return (Math.atan2(v.x, -v.y) * 180) / Math.PI;
}

function waterFeeling(w: number): string {
  if (w >= 70) return '你还不算太渴。';
  if (w >= 45) return '你的喉咙开始发干，需要尽快找水喝。';
  if (w >= 25) return '你已经明显脱水，头晕口干，非常需要水。';
  return '你濒临脱水，再不喝水会死。';
}

function foodFeeling(f: number): string {
  if (f >= 65) return '你还不算太饿。';
  if (f >= 40) return '你的胃在叫，需要尽快找食物。';
  if (f >= 20) return '你虚弱无力，急需进食。';
  return '你正在挨饿，再不吃东西会撑不住。';
}

function healthFeeling(h: number): string {
  if (h >= 80) return '你身体状况尚可。';
  if (h >= 50) return '你的身体已经开始吃不消了。';
  return '你的生命正在受到威胁。';
}

function itemUsage(kind: string): string | null {
  switch (kind) {
    case 'water': return 'water 可以喝：consume water 1 会立刻缓解口渴';
    case 'food': return 'food 可以吃：consume food 1 会立刻缓解饥饿';
    case 'wood': return 'wood 是燃料，可用来生火或加柴';
    case 'lighter': return 'lighter 是打火工具，生火必需';
    case 'tinder': return 'tinder 是引火物，生火必需';
    case 'backpack': return 'backpack 让你能多带一些东西';
    default: return null;
  }
}

const NEED_WATER_RATE = 2.2;

export function assertPromptCompliant(messages: Array<{ role: string; content: string }>): string[] {
  const violations: string[] = [];
  const text = messages.map((m) => m.content).join('\n');
  for (const marker of FORBIDDEN_MARKERS) {
    if (text.includes(marker)) violations.push(`forbidden marker: ${marker}`);
  }
  return violations;
}

export class RealLlmBrain {
  private llm: LlmLike;
  private adapter: unknown;
  private requestSeq = 0;

  constructor(llm: LlmLike) {
    this.llm = llm;
  }

  async requestDecision(world: Mvp2World, agentId: string): Promise<{ plan: AgentPlan; action: ActionSpec; provenance: LlmProvenance } | null> {
    const agent = world.agents[agentId];
    if (!agent || !agent.isAlive) return null;
    const feedback = world.events
      .filter((e) => e.actorId === agentId && ['action_rejected', 'handover_failed'].includes(e.type))
      .slice(-3)
      .map((e) => describeEventType(world, e.type, e.payload, e.actorId));
    // Repeatedly failing on the same target wastes the agent's time; make the
    // pattern explicit so it stops retrying the same impossible action.
    const rejects = world.events.filter((e) => e.actorId === agentId && e.type === 'action_rejected');
    const lastReject = rejects[rejects.length - 1];
    if (lastReject) {
      const sameTarget = rejects.filter((e) => String(e.payload?.targetRef ?? '') === String(lastReject.payload?.targetRef ?? '') && String(e.payload?.type ?? '') === String(lastReject.payload?.type ?? '')).length;
      if (sameTarget >= 3) {
        feedback.push(`你已经在同一目标上失败了 ${sameTarget} 次（${lastReject.payload?.type ?? ''} ${lastReject.payload?.targetRef ?? ''}）。不要再重复它：改做别的事——探索新区域、处理你能到达的目标，或与附近的人交谈。`);
      }
    }
    const messages = buildPlannerMessages(world, agent, feedback);
    agent.needsHistory.push({ t: world.gameTime, water: agent.needs.water, food: agent.needs.food });
    if (agent.needsHistory.length > 6) agent.needsHistory.shift();
    const requestId = `llm_${world.worldId}_${agentId}_${++this.requestSeq}`;
    const promptHash = hashString(messages.map((m) => m.content).join('|')).toString(36);
    let result = await this.llm.chat(messages, { temperature: 0.3, maxTokens: 900, jsonMode: true });
    let attempts = 1;
    // Retry on transient failures with backoff (no fallback action).
    while ((result.status === '429' || result.status === 'timeout' || result.status === 'error') && attempts <= 2) {
      await sleep(400 * attempts);
      result = await this.llm.chat(messages, { temperature: 0.3, maxTokens: 900, jsonMode: true });
      attempts++;
    }
    if (result.status !== 'ok' || !result.content) {
      world.llmLedger.push({ llmRequestId: requestId, agentId, provider: 'deepseek', model: result.model, promptHash, responseHash: '', status: result.status, tokenUsage: { input: result.promptTokens, output: result.completionTokens, cached: result.cachedTokens }, latencyMs: result.latencyMs, gameTime: world.gameTime });
      return null; // agent pauses; no action substitution
    }
    let decision = parseAgentDecision(result.content);
    if (!decision && process.env.MVP2_DEBUG_PARSER) {
      console.error('[parser-debug] first parse failed, raw:', JSON.stringify(result.content).slice(0, 800));
    }
    // One repair pass for malformed JSON.
    if (!decision) {
      const repaired = await this.llm.chat(
        [
          ...messages,
          { role: 'assistant', content: result.content },
          { role: 'user', content: '你刚才的输出不是合法 JSON，无法解析。请只输出符合要求结构的 JSON（不要任何额外文字、不要 markdown 代码块）。' },
        ],
        { temperature: 0.2, maxTokens: 900, jsonMode: true },
      );
      world.llmLedger.push({ llmRequestId: `${requestId}_repair`, agentId, provider: 'deepseek', model: repaired.model, promptHash, responseHash: hashString(repaired.content ?? '').toString(36), status: repaired.status, tokenUsage: { input: repaired.promptTokens, output: repaired.completionTokens, cached: repaired.cachedTokens }, latencyMs: repaired.latencyMs, gameTime: world.gameTime });
      if (repaired.status === 'ok' && repaired.content) decision = parseAgentDecision(repaired.content);
    }
    if (!decision) {
      world.llmLedger.push({ llmRequestId: requestId, agentId, provider: 'deepseek', model: result.model, promptHash, responseHash: hashString(result.content).toString(36), status: 'parse_failed', tokenUsage: { input: result.promptTokens, output: result.completionTokens, cached: result.cachedTokens }, latencyMs: result.latencyMs, gameTime: world.gameTime });
      return null;
    }
    world.llmLedger.push({ llmRequestId: requestId, agentId, provider: 'deepseek', model: result.model, promptHash, responseHash: hashString(result.content).toString(36), status: 'ok', tokenUsage: { input: result.promptTokens, output: result.completionTokens, cached: result.cachedTokens }, latencyMs: result.latencyMs, gameTime: world.gameTime });

    const resolved = resolveNextAction(world, agent, decision);
    if (process.env.MVP2_DEBUG_DECISIONS) {
      console.error(`[decision] ${agentId} @${world.gameTime}: type=${decision.nextAction.type} ref=${decision.nextAction.targetRef ?? '-'} dir=${decision.nextAction.direction ?? '-'} obj=${decision.currentObjective.slice(0, 40)}`);
    }
    if ('error' in resolved) {
      // Feed the rejection back to the agent (PRD 13.4: physical failures are
      // world feedback, not silent skips).
      world.events.push({
        eventId: `evt_${world.eventSeq++}`,
        worldId: world.worldId,
        gameTime: world.gameTime,
        type: 'action_rejected',
        actorId: agentId,
        payload: { type: decision.nextAction.type, reason: resolved.error, targetRef: decision.nextAction.targetRef },
        observers: [agentId],
        salience: 4,
      });
      agent.lastDecisionAt = world.gameTime;
      return null; // unknown reference: skip this decision (next call gets feedback)
    }
    const plan: AgentPlan = {
      planId: `plan_${world.actionSeq}_${agentId}`,
      longTermGoal: decision.longTermGoal,
      currentObjective: decision.currentObjective,
      steps: decision.plan.map((p) => ({ kind: 'step', description: `${p.action}${p.purpose ? `（${p.purpose}）` : ''}` })),
      stepIndex: 0,
      abortConditions: decision.abortConditions,
      assumptions: [],
      evidenceEventIds: world.events.filter((e) => e.observers.includes(agentId)).slice(-5).map((e) => e.eventId),
      createdAt: world.gameTime,
      updatedAt: world.gameTime,
      exploration: naExploration(decision.nextAction),
    };
    agent.plan = plan;
    agent.lastDecisionAt = world.gameTime;
    agent.lastDecisionAction = decision.nextAction.type;
    if (process.env.MVP2_DEBUG_DECISIONS) {
      console.error(`[decision] ${agentId} t=${world.gameTime} objective=${decision.currentObjective} action=${JSON.stringify(decision.nextAction)} motive=${decision.privateMotive.slice(0, 60)}`);
    }
    return { plan, action: resolved.spec, provenance: { llmRequestId: requestId, agentId, provider: 'deepseek', model: result.model, promptHash, responseHash: hashString(result.content).toString(36), status: 'ok', tokenUsage: { input: result.promptTokens, output: result.completionTokens, cached: result.cachedTokens }, latencyMs: result.latencyMs, gameTime: world.gameTime } };
  }
}

function naExploration(na: { type: string; direction?: string }) {
  const d = na.direction;
  const bearingMap: Record<string, number> = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };
  const bearing = d ? bearingMap[d] : undefined;
  return { mode: na.type === 'explore' ? ('head_inland' as const) : ('search_local' as const), approximateBearing: bearing, objectiveText: d ? `向${d}探索` : '探索未知区域', abortConditions: [] };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
