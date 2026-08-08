import { useEffect, useMemo, useRef, useState } from 'react';
import { useElementSize } from 'usehooks-ts';
import MapStage from './pixi/MapStage';
import type { Mvp2ClientWorld } from '../api/mvp2Client';
import type { WorldView } from '../state/useMvp2World';

const PRODUCT_SPEEDS = [1, 2, 4];
const DEBUG_SPEEDS = [1, 2, 4, 12, 24];

const ACTION_LABEL: Record<string, string> = {
  move: '移动',
  explore: '探索',
  pickup_item: '拾取',
  drop_item: '放下',
  offer_item: '递出物品',
  accept_handover: '接受递交',
  refuse_handover: '拒绝递交',
  take_unattended_item: '取物',
  search_wreckage: '搜索残骸',
  harvest_water: '取水',
  harvest_food: '采集浆果',
  harvest_wood: '收集木柴',
  consume: '喝水/进食',
  build_fire: '生火',
  add_fuel: '加柴',
  sleep: '睡觉',
  wake: '醒来',
  rest: '休息',
  shout: '呼喊',
  talk: '交谈',
  observe: '观察',
  approach: '走近',
};

const PHASE_LABEL: Record<string, string> = {
  approach: '走近',
  prepare: '准备',
  perform: '进行中',
  commit: '完成',
  recover: '收尾',
};

const ITEM_LABEL: Record<string, string> = { water: '水', food: '食物', wood: '木柴', tinder: '引火物', lighter: '打火工具', backpack: '背包' };
const RECORD_EVENT_TYPES = new Set([
  'message_spoken', 'shout', 'item_picked_up', 'item_dropped', 'wreck_searched', 'resource_discovered',
  'resource_harvested', 'consumed', 'offer_created', 'handover_completed', 'handover_refused', 'fire_lit',
  'sleep_started', 'woke_up', 'promise_kept', 'promise_broken', 'agent_died', 'plan_step_completed',
]);

function phaseOf(a: { phase: string } | null): string {
  return a ? (PHASE_LABEL[a.phase] ?? a.phase) : '空闲';
}

function dayTime(gameTime: number): { day: number; hh: string; phase: string } {
  const day = Math.floor(gameTime / 1440) + 1;
  const m = Math.floor(gameTime % 1440);
  const hh = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const phase = m < 360 ? '清晨' : m < 720 ? '白天' : m < 960 ? '黄昏' : '黑夜';
  return { day, hh, phase };
}

function bodyOverview(agent: Mvp2ClientWorld['agents'][string]): { label: string; tone: string; value: number } {
  if (!agent.isAlive) return { label: '已死亡', tone: 'text-slate-500', value: 0 };
  const value = Math.min(agent.needs.health, agent.needs.water, agent.needs.food, agent.needs.stamina);
  if (value < 25) return { label: '情况危险', tone: 'text-red-300', value };
  if (value < 50) return { label: '需要关注', tone: 'text-amber-300', value };
  return { label: '状态稳定', tone: 'text-emerald-300', value };
}

function relationshipSummary(value: { trust: number; resentment: number; dependency: number; affinity: number }): string {
  if (value.resentment >= 12) return '心存芥蒂';
  if (value.trust >= 14) return '相对信任';
  if (value.dependency >= 12) return '有所依赖';
  if (value.affinity >= 10) return '感到亲近';
  return '仍在观察';
}

function eventNarrative(world: Mvp2ClientWorld, event: Mvp2ClientWorld['events'][number]): string {
  const actor = event.actorId ? world.agents[event.actorId]?.name ?? event.actorId : '环境';
  const target = event.targetId ? world.agents[event.targetId]?.name ?? event.targetId : '';
  const rawKind = String(event.payload.kind ?? '物品');
  const kind = ITEM_LABEL[rawKind] ?? rawKind;
  const labels: Record<string, string> = {
    message_spoken: `${actor}说：“${String(event.payload.text ?? '').slice(0, 54)}”`,
    shout: `${actor}在岛上呼喊`,
    item_picked_up: `${actor}拾起了${kind}`,
    item_dropped: `${actor}放下了${kind}`,
    wreck_searched: `${actor}搜索了失事残骸`,
    resource_discovered: `${actor}发现了一处新资源`,
    resource_harvested: `${actor}采集了${kind}`,
    consumed: `${actor}使用了${kind}`,
    offer_created: `${actor}向${target}递出${kind}`,
    handover_completed: `${target}接受了${actor}递来的${kind}`,
    handover_refused: `${target}拒绝了${actor}递来的${kind}`,
    fire_lit: `${actor}生起了火`,
    sleep_started: `${actor}睡下了`,
    woke_up: `${actor}醒来了`,
    promise_kept: `${actor}兑现了对${target}的承诺`,
    promise_broken: `${actor}没有兑现对${target}的承诺`,
    plan_step_completed: `${actor}完成了计划中的一步`,
    agent_died: `${actor}没能活下来`,
  };
  return labels[event.type] ?? `${actor}${actor ? '发生了行动' : ''}`;
}

function eventTime(gameTime: number): string {
  const day = Math.floor(gameTime / 1440) + 1;
  const minutes = Math.floor(gameTime % 1440);
  return `第${day}日 ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export default function GameView({
  world,
  connected,
  view,
  setView,
  followAgent,
  setFollowAgent,
  error,
  control,
  onEnded,
  onRestart,
}: {
  world: Mvp2ClientWorld;
  connected: boolean;
  view: WorldView;
  setView: (v: WorldView) => void;
  followAgent: string | null;
  setFollowAgent: (id: string | null) => void;
  error: string | null;
  control: (action: 'pause' | 'resume', timeScale?: number) => Promise<void>;
  onEnded: () => void;
  onRestart: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [speed, setSpeed] = useState(1);
  const debugMode = useMemo(() => new URLSearchParams(window.location.search).get('debug') === '1', []);
  const [stageRef, { width, height }] = useElementSize();
  const endedNotified = useRef(false);

  const aliveCount = Object.values(world.agents).filter((a) => a.isAlive).length;
  if (world.status === 'ended' && !endedNotified.current) {
    endedNotified.current = true;
    setTimeout(onEnded, 800);
  }

  useEffect(() => {
    if (!debugMode && view !== 'god') setView('god');
  }, [debugMode, setView, view]);

  const changeSpeed = async (s: number) => {
    setSpeed(s);
    await control('resume', s);
  };

  const { day, hh, phase } = dayTime(world.gameTime);
  const agents = Object.values(world.agents);
  const speeds = debugMode ? DEBUG_SPEEDS : PRODUCT_SPEEDS;
  const selectedAgent = selected ? world.agents[selected] : null;

  useEffect(() => {
    const runtimeWindow = window as unknown as {
      render_game_to_text?: () => string;
      advanceTime?: (ms: number) => Promise<void>;
      __phase31PresentationTelemetry?: {
        actors: Array<Record<string, unknown>>;
        bubbles: Array<Record<string, unknown>>;
      };
    };
    runtimeWindow.render_game_to_text = () => JSON.stringify({
      schema: 'aisland.phase31.game_state_text.v1',
      map: { width: 80, height: 52, assetVersion: 'phase31' },
      visualAssetVersion: 'phase31-props-v1',
      mapDesignVersion: 'small-island-deep-agents-v1',
      worldId: world.worldId,
      status: world.status,
      gameTime: world.gameTime,
      coordinates: { origin: 'top-left', xAxis: 'right/east', yAxis: 'down/south', unit: 'tile' },
      view,
      followAgent,
      actors: runtimeWindow.__phase31PresentationTelemetry?.actors ?? agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        x: agent.x,
        y: agent.y,
        alive: agent.isAlive,
        sleeping: agent.sleeping,
        action: agent.currentAction
          ? { type: agent.currentAction.type, phase: agent.currentAction.phase, progress: agent.currentAction.progress }
          : null,
      })),
      bubbles: runtimeWindow.__phase31PresentationTelemetry?.bubbles ?? [],
      worldObjects: [
        ...world.resources.map((resource) => ({ objectId: resource.id, semanticType: resource.kind, assetId: resource.kind, state: resource.stock <= 0 ? 'depleted' : resource.stock / Math.max(1, resource.capacity) < 0.72 ? 'used' : 'full', x: resource.x, y: resource.y, visible: true })),
        ...world.wrecks.map((wreck) => ({ objectId: wreck.wreckId, semanticType: 'wreck_main', assetId: wreck.searched ? 'wreck_fuselage_searched' : 'wreck_fuselage_full', state: wreck.searched ? 'searched' : 'full', x: wreck.x, y: wreck.y, visible: true })),
        ...world.groundItems.map((item) => ({ objectId: item.itemId, semanticType: 'ground_item', assetId: item.kind, state: 'ground', x: item.x, y: item.y, visible: true })),
        ...world.fires.map((fire) => ({ objectId: fire.fireId, semanticType: 'fire', assetId: `fire_${fire.state}`, state: fire.state, x: fire.x, y: fire.y, visible: true })),
      ],
      visualEffects: world.presentationEvents.filter((event) => !['speech', 'shout'].includes(event.kind) && world.gameTime - event.gameTime <= 30).map((event) => ({ sourceEventId: event.sourceEventId, kind: event.kind, actorId: event.actorId, targetId: event.targetId })),
      ui: { logDrawerOpen: timelineOpen, inspectorOpen: selected !== null },
      viewport: { width, height },
    });
    if (typeof runtimeWindow.advanceTime !== 'function') {
      runtimeWindow.advanceTime = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    }
    return () => {
      delete runtimeWindow.render_game_to_text;
    };
  }, [agents, followAgent, height, selected, timelineOpen, view, width, world.fires, world.gameTime, world.groundItems, world.presentationEvents, world.resources, world.status, world.worldId, world.wrecks]);

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-hidden bg-slate-950 font-system text-slate-100">
      {/* Product HUD stays below the 44px gate and contains viewing controls only. */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-white/10 bg-slate-950/95 px-3 text-sm shadow-[inset_0_-1px_0_rgba(255,255,255,0.03)] sm:px-4">
        <div data-testid="hud-time" className="flex min-w-0 items-baseline gap-2 tabular-nums">
          <span className="font-semibold text-amber-300">第 {day} 日</span>
          <span className="font-medium text-slate-100">{hh}</span>
          <span className="hidden text-xs text-slate-400 sm:inline">{phase}</span>
        </div>
        <div className="hidden text-xs text-slate-500 sm:block">幸存 {aliveCount}/3</div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-white/10 bg-slate-900/80 p-0.5" aria-label="世界速度">
            {PRODUCT_SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => void changeSpeed(value)}
                className={`min-w-8 rounded px-1.5 py-1 text-[11px] tabular-nums transition active:scale-[0.98] ${speed === value ? 'bg-amber-300 text-slate-950' : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'}`}
                aria-pressed={speed === value}
              >
                {value}x
              </button>
            ))}
          </div>
          {world.status === 'running' && (
            <button onClick={() => void control('pause')} className="rounded-md border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs transition hover:bg-slate-700 active:scale-[0.98]" data-testid="btn-pause">
              暂停
            </button>
          )}
          {world.status === 'paused' && (
            <button onClick={() => void control('resume')} className="rounded-md bg-emerald-700 px-2.5 py-1.5 text-xs transition hover:bg-emerald-600 active:scale-[0.98]" data-testid="btn-resume">
              继续
            </button>
          )}
          <button
            type="button"
            onClick={() => setTimelineOpen((value) => !value)}
            className={`rounded-md border px-2.5 py-1.5 text-xs transition active:scale-[0.98] ${timelineOpen ? 'border-amber-300/50 bg-amber-300 text-slate-950' : 'border-white/10 bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
            data-testid="timeline-toggle"
            aria-expanded={timelineOpen}
          >
            记录
          </button>
          <span className={`ml-0.5 inline-block h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} title={connected ? '世界连接正常' : '世界连接已中断'} />
        </div>
      </header>
      {error && <div className="bg-red-900/60 px-4 py-1 text-xs text-red-200">{error}</div>}

      <div className="relative min-h-0 flex-1">
        <div ref={stageRef} className="absolute inset-0 bg-[#0f1f3a]">
          {width > 50 && height > 50 && (
            <MapStage
              width={width}
              height={height}
              agents={Object.fromEntries(
                agents.map((a) => [
                  a.id,
                  {
                    x: a.x,
                    y: a.y,
                    facing: a.facing,
                    isAlive: a.isAlive,
                    name: a.name,
                    action: a.currentAction ? { type: a.currentAction.type, phase: a.currentAction.phase, progress: a.currentAction.progress, visualActionId: a.currentAction.visualActionId, commitAt: a.currentAction.commitAt } : null,
                    sleeping: a.sleeping,
                    selected: selected === a.id,
                  },
                ]),
              )}
              resources={world.resources.map((r) => ({ id: r.id, kind: r.kind, x: r.x, y: r.y, stock: r.stock, capacity: r.capacity }))}
              wrecks={world.wrecks}
              groundItems={world.groundItems.map((g) => ({ itemId: g.itemId, kind: g.kind, x: g.x, y: g.y }))}
              fires={world.fires.map((f) => ({ fireId: f.fireId, x: f.x, y: f.y, state: f.state }))}
              presentationEvents={world.presentationEvents}
              gameTime={world.gameTime}
              view={view}
              followAgent={followAgent}
              showDebug={debugMode && showDebug}
              onSelectAgent={(id) => setSelected((current) => current === id ? null : id)}
              onFocusAgent={setFollowAgent}
            />
          )}
        </div>

        {/* Cognitive views, fast speeds and provenance stay behind ?debug=1. */}
        {debugMode && (
          <div className="absolute left-3 top-3">
            <button
              type="button"
              onClick={() => setShowDebug((value) => !value)}
              className="rounded-md border border-amber-300/30 bg-slate-950/85 px-2.5 py-1.5 text-[11px] text-amber-200 backdrop-blur transition active:scale-[0.98]"
              aria-expanded={showDebug}
            >
              开发工具
            </button>
            {showDebug && (
              <div className="mt-2 w-72 divide-y divide-white/10 rounded-lg border border-white/10 bg-slate-950/95 text-xs shadow-[0_18px_48px_-22px_rgba(2,6,23,0.9)] backdrop-blur">
                <div className="flex flex-wrap gap-1 p-2">
                  {(['god', 'agent_a', 'agent_b', 'agent_c'] as WorldView[]).map((value) => (
                    <button key={value} data-testid={`view-${value}`} onClick={() => setView(value)} className={`rounded px-2 py-1 ${view === value ? 'bg-amber-300 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                      {value === 'god' ? '全知视角' : world.agents[value]?.name ?? value}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 p-2">
                  {speeds.map((value) => (
                    <button key={value} onClick={() => void changeSpeed(value)} className={`rounded px-2 py-1 tabular-nums ${speed === value ? 'bg-amber-300 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                      {value}x
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between p-2 text-[11px] text-slate-400">
                  <span>LLM {world.llm.calls} 次 · P95 {world.llm.p95LatencyMs}ms</span>
                  <a href={`/api/mvp2/worlds/${world.worldId}/export`} download className="text-amber-200 underline underline-offset-2" data-testid="btn-export">导出证据</a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Compact agent cards (left) */}
        <div className="absolute bottom-2 left-2 flex max-w-[calc(100vw-1rem)] flex-row gap-1.5 overflow-x-auto pb-0.5 md:bottom-3 md:left-3 md:flex-col md:overflow-visible">
          {agents.map((a) => (
            (() => {
              const body = bodyOverview(a);
              return (
                <button
                  key={a.id}
                  data-testid={`card-${a.id}`}
                  onClick={() => setSelected((current) => current === a.id ? null : a.id)}
                  className={`w-40 shrink-0 rounded-lg border px-2.5 py-2 text-left text-xs shadow-[0_12px_30px_-18px_rgba(2,6,23,0.9)] backdrop-blur transition active:scale-[0.98] md:w-44 ${selected === a.id ? 'border-amber-300/60 bg-slate-900/95' : 'border-white/10 bg-slate-950/80 hover:border-white/25'} ${!a.isAlive ? 'opacity-60' : ''}`}
                  aria-pressed={selected === a.id}
                >
                  <div className="flex items-center gap-2">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 text-[11px] font-semibold ${a.id === 'agent_a' ? 'bg-sky-900/70 text-sky-200' : a.id === 'agent_b' ? 'bg-emerald-900/70 text-emerald-200' : 'bg-orange-900/70 text-orange-200'}`}>{a.name.slice(0, 1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-100">{a.name}</span>
                        <span className={`text-[10px] ${body.tone}`}>{body.label}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                        {a.sleeping ? '睡觉中' : a.currentAction ? `${ACTION_LABEL[a.currentAction.type] ?? a.currentAction.type} · ${phaseOf(a.currentAction)}` : '正在观察周围'}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })()
          ))}
        </div>

        {/* Insight panel (right), opens on card click */}
        {selectedAgent && (
          <div className="absolute bottom-2 left-2 right-2 flex max-h-[62vh] flex-col rounded-xl border border-white/10 bg-slate-950/95 shadow-[0_24px_64px_-24px_rgba(2,6,23,0.95)] backdrop-blur md:bottom-3 md:left-auto md:right-3 md:w-[340px]">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
              <div>
                <span className="font-bold">{selectedAgent.name}</span>
                <span className="ml-2 text-[10px] text-slate-500">人物洞察</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setFollowAgent(followAgent === selectedAgent.id ? null : selectedAgent.id)} className="rounded px-2 py-1 text-[11px] text-amber-200 transition hover:bg-white/10 active:scale-[0.98]">{followAgent === selectedAgent.id ? '停止跟随' : '聚焦'}</button>
                <button onClick={() => setSelected(null)} className="rounded px-2 py-1 text-[11px] text-slate-400 transition hover:bg-white/10 active:scale-[0.98]" data-testid="close-inspector">关闭</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
              <InsightBody agent={selectedAgent} world={world} showDebug={debugMode && showDebug} />
            </div>
          </div>
        )}

        {/* Record drawer is for review only and stays fully closed by default. */}
        <aside className={`absolute bottom-0 right-0 top-0 flex w-[min(390px,92vw)] flex-col border-l border-white/10 bg-slate-950/[0.97] shadow-[0_0_60px_-24px_rgba(2,6,23,0.95)] backdrop-blur transition duration-300 ease-out ${timelineOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'}`} aria-hidden={!timelineOpen}>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <div className="font-semibold text-slate-100">岛上记录</div>
              <div className="text-[11px] text-slate-500">用于复盘，不替代地图里的实时叙事</div>
            </div>
            <button type="button" onClick={() => setTimelineOpen(false)} className="rounded px-2 py-1 text-xs text-slate-400 transition hover:bg-white/10 active:scale-[0.98]">关闭</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {[...world.events].reverse().filter((event) => event.salience >= 4 && RECORD_EVENT_TYPES.has(event.type)).slice(0, 80).map((event) => (
              <div key={event.eventId} className="border-b border-white/5 py-2.5 last:border-0">
                <div className="text-[10px] tabular-nums text-slate-500">{eventTime(event.gameTime)}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-slate-200">{eventNarrative(world, event)}</div>
                {debugMode && showDebug && <div className="mt-0.5 font-mono text-[9px] text-slate-600">{event.type} · {event.eventId}</div>}
              </div>
            ))}
            {world.events.length === 0 && <div className="py-10 text-center text-xs text-slate-500">岛上还没有留下记录</div>}
          </div>
          <div className="flex items-center justify-between border-t border-white/10 p-3">
            <span className="text-[10px] text-slate-600">最近 80 条重要记录</span>
            <button onClick={onRestart} className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 active:scale-[0.98]" data-testid="btn-restart">新的一局</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function InsightBody({ agent, world, showDebug }: { agent: NonNullable<Mvp2ClientWorld['agents'][string]>; world: Mvp2ClientWorld; showDebug: boolean }) {
  const body = bodyOverview(agent);
  const relations = Object.entries(agent.relationships)
    .map(([id, relation]) => ({ id, name: world.agents[id]?.name ?? id, relation }))
    .filter(({ relation }) => relation.trust !== 0 || relation.resentment !== 0 || relation.dependency !== 0 || relation.affinity !== 0);
  const activeStep = agent.plan?.steps[agent.plan.currentStepIndex];
  const memories = [...agent.episodicMemories].slice(-2).reverse();
  return (
    <div className="divide-y divide-white/10">
      <section className="pb-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">此刻想做什么</div>
        {agent.plan ? (
          <div className="mt-1.5">
            <div className="text-sm font-semibold leading-snug text-amber-200">{activeStep?.intent ?? agent.plan.goal}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-400">长期目标：{agent.plan.goal}</div>
            <div className="mt-2 rounded-md border-l-2 border-amber-300/50 bg-white/[0.03] px-2.5 py-2 text-[11px] leading-relaxed text-slate-300">
              <span className="text-slate-500">私人动机</span><br />
              {agent.privateMotive || '尚未形成明确的私人动机'}
            </div>
          </div>
        ) : (
          <div className="mt-1.5 text-slate-500">尚未形成持续计划</div>
        )}
      </section>

      <section className="py-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">身体与行动</div>
          <span className={`text-[11px] ${body.tone}`}>{body.label}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`身体概况 ${body.label}`}>
          <div className={`h-full rounded-full ${body.value < 25 ? 'bg-red-400' : body.value < 50 ? 'bg-amber-300' : 'bg-emerald-400'}`} style={{ width: `${Math.max(3, body.value)}%` }} />
        </div>
        <div className="mt-2 text-[11px] text-slate-300">
          {agent.sleeping ? '正在睡觉' : agent.currentAction ? `${ACTION_LABEL[agent.currentAction.type] ?? agent.currentAction.type} · ${phaseOf(agent.currentAction)}` : '目前没有明确动作'}
        </div>
        <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-400">
          {Object.entries(agent.inventory).length === 0 && <span>空手</span>}
          {Object.entries(agent.inventory).map(([k, v]) => (
            <span key={k} className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
              {ITEM_LABEL[k] ?? k}×{v}
            </span>
          ))}
        </div>
      </section>

      <section className="py-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">关键记忆</div>
        <div className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-slate-300">
          {memories.length === 0 && <div className="text-slate-500">还没有留下关键记忆</div>}
          {memories.map((memory) => <div key={memory.memoryId} className="border-l border-white/15 pl-2">{memory.summary}</div>)}
          {agent.reflections.slice(-1).map((reflection) => <div key={reflection.reflectionId} className="text-slate-400">最近反思：{reflection.summary}</div>)}
        </div>
      </section>

      <section className="py-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">怎么看待其他人</div>
        <div className="mt-1.5 space-y-1 text-[11px] text-slate-300">
          {relations.length === 0 && <div className="text-slate-500">还没有形成明确判断</div>}
          {relations.map(({ id, name, relation }) => (
            <div key={id} className="flex items-center justify-between gap-3">
              <span>{name}</span>
              <span className="text-slate-400">{relationshipSummary(relation)}</span>
            </div>
          ))}
        </div>
      </section>

      {showDebug && (
        <section className="pt-3 font-mono text-[10px] text-amber-100/80">
          <div className="font-semibold text-amber-200">开发信息</div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
            <span>水分 {Math.round(agent.needs.water)}</span>
            <span>食物 {Math.round(agent.needs.food)}</span>
            <span>体力 {Math.round(agent.needs.stamina)}</span>
            <span>健康 {Math.round(agent.needs.health)}</span>
            <span>稳定 {Math.round(agent.mental.mentalStability)}</span>
            <span>恐惧 {Math.round(agent.mental.fear)}</span>
            <span>负重 {agent.carryUsed}</span>
            <span>决策 {agent.decisions}</span>
          </div>
          {agent.plan && (
            <div className="mt-2 space-y-0.5 border-t border-amber-200/10 pt-2">
              {agent.plan.steps.map((step, index) => <div key={step.stepId}>{index}. [{step.status}] {step.actionType} {step.targetRef ?? ''}</div>)}
            </div>
          )}
          <div className="mt-2 border-t border-amber-200/10 pt-2">
            LLM {world.llm.calls} · input {world.llm.inputTokens} · output {world.llm.outputTokens} · P95 {world.llm.p95LatencyMs}ms
          </div>
        </section>
      )}
    </div>
  );
}
