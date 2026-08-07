import { useEffect, useMemo, useRef, useState } from 'react';
import { useElementSize } from 'usehooks-ts';
import MapStage from './pixi/MapStage';
import type { Mvp2ClientWorld } from '../api/mvp2Client';
import type { WorldView } from '../state/useMvp2World';

const SPEEDS = [1, 2, 4, 8, 16, 32];

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

function needColor(v: number): string {
  return v < 25 ? 'text-red-400' : v < 50 ? 'text-amber-300' : 'text-emerald-300';
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
  const [speed, setSpeed] = useState(2);
  const [stageRef, { width, height }] = useElementSize();
  const endedNotified = useRef(false);

  const aliveCount = Object.values(world.agents).filter((a) => a.isAlive).length;
  if (world.status === 'ended' && !endedNotified.current) {
    endedNotified.current = true;
    setTimeout(onEnded, 800);
  }

  useEffect(() => {
    if (!selected && Object.values(world.agents).length) {
      const first = Object.values(world.agents).find((a) => a.isAlive) ?? Object.values(world.agents)[0];
      setSelected(first?.id ?? null);
    }
  }, [selected, world.agents]);

  const changeSpeed = async (s: number) => {
    setSpeed(s);
    await control('resume', s);
  };

  const { day, hh, phase } = dayTime(world.gameTime);
  const agents = Object.values(world.agents);
  const selectedAgent = selected ? world.agents[selected] : null;

  // Major events for lightweight toasts (top 6 recent salient).
  const majorEvents = useMemo(
    () =>
      world.events
        .filter((e) => e.salience >= 5)
        .slice(-6)
        .reverse(),
    [world.events],
  );

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top HUD: time, phase, pause, speed, actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 bg-slate-900 px-4 py-1.5 text-sm">
        <div className="font-bold text-amber-400">AI 原生荒岛</div>
        <div data-testid="hud-time" className="tabular-nums">
          第 {day} 日 {hh} · {phase}
        </div>
        <div className="text-xs text-slate-400">幸存 {aliveCount}/3</div>
        <div className="ml-auto flex items-center gap-2">
          {world.status === 'running' && (
            <button onClick={() => void control('pause')} className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600" data-testid="btn-pause">
              暂停
            </button>
          )}
          {world.status === 'paused' && (
            <button onClick={() => void control('resume')} className="rounded bg-emerald-700 px-3 py-1 text-xs hover:bg-emerald-600" data-testid="btn-resume">
              继续
            </button>
          )}
          <select
            value={speed}
            onChange={(e) => void changeSpeed(Number(e.target.value))}
            className="rounded bg-slate-800 px-2 py-1 text-xs"
            title="世界倍速"
            data-testid="select-speed"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <a href={`/api/mvp2/worlds/${world.worldId}/export`} download className="rounded bg-sky-700 px-3 py-1 text-xs hover:bg-sky-600" data-testid="btn-export">
            导出证据
          </a>
          <button onClick={onRestart} className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600" data-testid="btn-restart">
            新的一局
          </button>
          <button
            onClick={() => setShowDebug((v) => !v)}
            className={`rounded px-3 py-1 text-xs ${showDebug ? 'bg-amber-700' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            title="内部调试信息（技术字段）"
          >
            Debug
          </button>
          <span className={`ml-1 inline-block h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} title={connected ? '已连接' : '连接断开'} />
        </div>
      </div>
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
                    action: a.currentAction ? { type: a.currentAction.type, phase: a.currentAction.phase, progress: a.currentAction.progress } : null,
                    sleeping: a.sleeping,
                    selected: selected === a.id,
                  },
                ]),
              )}
              resources={world.resources.map((r) => ({ id: r.id, kind: r.kind, x: r.x, y: r.y, stock: r.stock }))}
              groundItems={world.groundItems.map((g) => ({ itemId: g.itemId, kind: g.kind, x: g.x, y: g.y }))}
              fires={world.fires.map((f) => ({ fireId: f.fireId, x: f.x, y: f.y, state: f.state }))}
              view={view}
              followAgent={followAgent}
              onSelectAgent={setSelected}
            />
          )}
        </div>

        {/* View toggles + follow */}
        <div className="absolute left-3 top-3 flex flex-col gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-900/80 p-1 text-xs backdrop-blur">
            {(['god', 'agent_a', 'agent_b', 'agent_c'] as WorldView[]).map((v) => (
              <button
                key={v}
                data-testid={`view-${v}`}
                onClick={() => setView(v)}
                className={`rounded px-2 py-1 ${view === v ? 'bg-amber-500 font-bold text-slate-900' : 'text-slate-300 hover:bg-slate-700'}`}
              >
                {v === 'god' ? '上帝视角' : world.agents[v]?.name ?? v}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-900/80 p-1 text-xs backdrop-blur">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => setFollowAgent(followAgent === a.id ? null : a.id)}
                className={`rounded px-2 py-1 ${followAgent === a.id ? 'bg-sky-600 font-bold text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                title="跟随镜头"
              >
                👁 {a.name}
              </button>
            ))}
          </div>
        </div>

        {/* Compact agent cards (left) */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1.5">
          {agents.map((a) => (
            <button
              key={a.id}
              data-testid={`card-${a.id}`}
              onClick={() => setSelected(a.id)}
              className={`w-52 rounded-lg border p-2 text-left text-xs transition ${selected === a.id ? 'border-amber-500 bg-slate-800' : 'border-slate-700 bg-slate-900/80 hover:border-slate-500'} ${!a.isAlive ? 'opacity-50' : ''}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-bold">{a.isAlive ? a.name : `${a.name}（死亡）`}</span>
                <span className="text-[10px] text-sky-300">{phaseOf(a.currentAction)}</span>
              </div>
              <div className="mt-0.5 grid grid-cols-4 gap-x-1 text-[10px]">
                <span title="口渴"><span className="text-slate-400">💧</span> <span className={needColor(a.needs.water)}>{Math.round(a.needs.water)}</span></span>
                <span title="饥饿"><span className="text-slate-400">🍗</span> <span className={needColor(a.needs.food)}>{Math.round(a.needs.food)}</span></span>
                <span title="体力"><span className="text-slate-400">⚡</span> {Math.round(a.needs.stamina)}</span>
                <span title="健康"><span className="text-slate-400">❤️</span> <span className={needColor(a.needs.health)}>{Math.round(a.needs.health)}</span></span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-slate-400">
                {a.currentAction ? `${ACTION_LABEL[a.currentAction.type] ?? a.currentAction.type} ${Math.round(a.currentAction.progress * 100)}%` : '空闲'}
                {a.sleeping ? ' · 睡觉中' : ''}
              </div>
            </button>
          ))}
        </div>

        {/* Insight panel (right), opens on card click */}
        {selectedAgent && (
          <div className="absolute bottom-3 right-3 top-3 flex w-[360px] flex-col rounded-xl border border-slate-700 bg-slate-900/95 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
              <div>
                <span className="font-bold">{selectedAgent.name}</span>
                <span className="ml-2 text-[10px] text-slate-400">全知洞察</span>
              </div>
              <button onClick={() => setSelected(null)} className="rounded px-2 py-0.5 text-slate-400 hover:bg-slate-800" data-testid="close-inspector">
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
              <InsightBody agent={selectedAgent} world={world} showDebug={showDebug} />
            </div>
          </div>
        )}

        {/* Timeline: collapsed by default, lightweight recent-major-events */}
        <div className="absolute bottom-3 left-1/2 w-[640px] max-w-[60vw] -translate-x-1/2">
          <button
            onClick={() => setTimelineOpen((v) => !v)}
            data-testid="timeline-toggle"
            className="w-full rounded-t-lg bg-slate-900/85 px-3 py-1.5 text-left text-[11px] text-slate-300 backdrop-blur"
          >
            {timelineOpen ? '▼ 事件时间线' : '▲ 最近事件'}
            <span className="ml-2 text-slate-500">{majorEvents.length > 0 ? majorEvents[0].type : ''}</span>
          </button>
          {timelineOpen && (
            <div className="max-h-40 overflow-y-auto rounded-b-lg border-t border-slate-700 bg-slate-900/90 p-2 text-[11px] backdrop-blur">
              {[...world.events].reverse().slice(0, 40).map((e) => (
                <div key={e.eventId} className="flex gap-2 py-0.5">
                  <span className="tabular-nums text-slate-500">{Math.floor(e.gameTime / 60)}h</span>
                  <span className="text-slate-300">{e.type}</span>
                  {e.actorId && <span className="text-sky-400">{world.agents[e.actorId]?.name ?? e.actorId}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InsightBody({ agent, world, showDebug }: { agent: NonNullable<Mvp2ClientWorld['agents'][string]>; world: Mvp2ClientWorld; showDebug: boolean }) {
  const relations = Object.entries(agent.relationships)
    .map(([id, r]) => ({ name: world.agents[id]?.name ?? id, ...r }))
    .filter((r) => r.trust !== 0 || r.resentment !== 0 || r.dependency !== 0 || r.affinity !== 0);
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 font-bold text-slate-300">当前计划</div>
        {agent.plan ? (
          <>
            <div className="text-amber-300">长期目标：{agent.plan.longTermGoal}</div>
            <div className="text-sky-300">当前目标：{agent.plan.currentObjective}</div>
            <div className="mt-1 space-y-0.5 text-slate-400">
              {agent.plan.steps.map((s, i) => (
                <div key={i} className={i === agent.plan!.stepIndex ? 'text-slate-200' : ''}>
                  {i === agent.plan!.stepIndex ? '› ' : '· '}
                  {s.description}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-slate-500">尚未形成计划</div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-[10px] text-slate-400">心理稳定</div>
          <div className="font-bold">{Math.round(agent.mental.mentalStability)}</div>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-[10px] text-slate-400">恐惧</div>
          <div className="font-bold text-amber-300">{Math.round(agent.mental.fear)}</div>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-[10px] text-slate-400">社会安全感</div>
          <div className="font-bold">{Math.round(agent.mental.socialSafety)}</div>
        </div>
      </div>
      <div>
        <div className="mb-1 font-bold text-slate-300">随身物品</div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(agent.inventory).length === 0 && <span className="text-slate-500">空手</span>}
          {Object.entries(agent.inventory).map(([k, v]) => (
            <span key={k} className="rounded bg-slate-800 px-1.5 py-0.5">
              {k}×{v}
            </span>
          ))}
        </div>
        <div className="mt-1 text-[10px] text-slate-500">已探索 {agent.explored} 格 · 决策 {agent.decisions} 次</div>
      </div>
      <div>
        <div className="mb-1 font-bold text-slate-300">人际关系</div>
        {relations.length === 0 && <span className="text-slate-500">尚未建立</span>}
        {relations.map((r) => (
          <div key={r.name} className="text-[11px] text-slate-400">
            {r.name}：信任 {Math.round(r.trust)} · 怨恨 {Math.round(r.resentment)} · 依赖 {Math.round(r.dependency)} · 亲和 {Math.round(r.affinity)}
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 font-bold text-slate-300">知识与传闻</div>
        <div className="text-[11px] text-slate-400">
          已知资源：{agent.knownResources.length > 0 ? agent.knownResources.join('、') : '无'}
        </div>
        <div className="text-[11px] text-slate-400">听到的传闻：{agent.heardClaims.length > 0 ? agent.heardClaims.length : '无'}</div>
      </div>
      {showDebug && (
        <div className="rounded border border-amber-800/60 bg-amber-950/30 p-2 text-[10px] text-amber-200">
          <div className="mb-1 font-bold">内部调试（仅开发）</div>
          <div>LLM 调用 {world.llm.calls} 次 · 输入 {world.llm.inputTokens} · 输出 {world.llm.outputTokens} tok</div>
          <div>延迟 P95 {world.llm.p95LatencyMs}ms · 平均 {world.llm.avgLatencyMs}ms</div>
          <div>上次动作：{agent.lastDecisionAction ?? '—'} · 负重 {agent.carryUsed}</div>
          <div className="mt-1">
            <a href={`/api/mvp2/worlds/${world.worldId}/export`} download className="text-sky-300 underline">
              导出完整证据包
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
