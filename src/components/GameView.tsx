import { useMemo, useRef, useState } from 'react';
import { Component, type ReactNode } from 'react';
import { useElementSize } from 'usehooks-ts';
import { IslandStage } from './pixi/IslandStage';
import { InspectorPanel } from './panels/InspectorPanel';
import { EventStream } from './panels/EventStream';
import { RelationshipTriangle } from './panels/RelationshipTriangle';
import type { ClientWorld } from '../api/client';
import type { WorldView } from '../state/useWorld';
import { formatGameTime } from '../../server/engine/scenario';

const SPEEDS = [1, 2, 4, 30, 120, 240];

export default function GameView({
  world,
  connected,
  view,
  setView,
  error,
  control,
  onEnded,
  onRestart,
}: {
  world: ClientWorld;
  connected: boolean;
  view: WorldView;
  setView: (v: WorldView) => void;
  error: string | null;
  control: (a: 'start' | 'pause' | 'resume' | 'end') => Promise<void>;
  onEnded: () => void;
  onRestart: () => void;
}) {
  (window as unknown as { __renderCount?: number }).__renderCount =
    ((window as unknown as { __renderCount?: number }).__renderCount ?? 0) + 1;
  if ((window as unknown as { __wsDebug?: boolean }).__wsDebug) {
    console.log('[render]', world.worldId, Math.round(world.gameTime), 'status', world.status);
  }
  const [selected, setSelected] = useState<string | null>('agent_a');
  const [tab, setTab] = useState<'overview' | 'events' | 'relations'>('overview');
  const [speed, setSpeed] = useState(world.scenario.timeScale);
  const [stageRef, { width, height }] = useElementSize();
  const endedNotified = useRef(false);

  const aliveCount = Object.values(world.agents).filter((a) => a.isAlive).length;
  if (world.status === 'ended' && !endedNotified.current) {
    endedNotified.current = true;
    setTimeout(onEnded, 800);
  }

  const changeSpeed = async (s: number) => {
    setSpeed(s);
    const resp = await fetch(`/api/worlds/${world.worldId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'speed', timeScale: s }),
    });
    void resp;
  };

  const day = Math.floor(world.gameTime / 1440) + 1;
  const llm = world.llmUsage.summary;
  const nodeSummary = useMemo(() => {
    return Object.values(world.resources).map((n) => `${n.kind === 'spring' ? '泉' : n.kind === 'grove' ? '椰' : '潮'} ${n.stock}/${n.capacity}`);
  }, [world.resources]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top HUD */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 bg-slate-900 px-4 py-2 text-sm">
        <div className="font-bold text-amber-400">AI 原生荒岛</div>
        <div data-testid="hud-time">
          第 {day} 日 · {formatGameTime(world.gameTime)}
        </div>
        <div className="text-xs text-slate-400">
          状态：{world.status === 'running' ? '运行中' : world.status === 'paused' ? '已暂停' : '已结束'}
        </div>
        <div className="text-xs text-slate-400">
          幸存 {aliveCount}/3 · {nodeSummary.join(' · ')}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {world.status === 'running' && (
            <button onClick={() => void control('pause')} className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600">
              暂停
            </button>
          )}
          {world.status === 'paused' && (
            <button onClick={() => void control('resume')} className="rounded bg-emerald-700 px-3 py-1 text-xs hover:bg-emerald-600">
              继续
            </button>
          )}
          <select
            value={speed}
            onChange={(e) => void changeSpeed(Number(e.target.value))}
            className="rounded bg-slate-800 px-2 py-1 text-xs"
            title="世界速度（创建时确定，此处仅显示）"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <a
            href={`/api/worlds/${world.worldId}/export`}
            download
            className="rounded bg-sky-700 px-3 py-1 text-xs hover:bg-sky-600"
          >
            导出 JSON
          </a>
          <button onClick={onRestart} className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600">
            新的一局
          </button>
          <span className={`ml-1 inline-block h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} title={connected ? '已连接' : '连接断开'} />
        </div>
      </div>
      {error && <div className="bg-red-900/60 px-4 py-1 text-xs text-red-200">{error}</div>}
      <div className="flex min-h-0 flex-1">
        {/* Stage */}
        <div ref={stageRef} className="relative min-w-0 flex-1 bg-[#0f1f3a]">
          {width > 50 && height > 50 && (
            <PixiBoundary>
              <IslandStage world={world} view={view} selectedAgentId={selected} onSelectAgent={setSelected} width={width} height={height} />
            </PixiBoundary>
          )}
          {/* Knowledge view toggle */}
          <div className="absolute left-3 top-3 flex gap-1 rounded-lg bg-slate-900/80 p-1 text-xs backdrop-blur">
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
          <div className="absolute bottom-3 left-3 rounded bg-slate-900/70 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur">
            {view === 'god' ? '全知视角：显示所有真实资源与动机' : `认知视角：只显示 ${world.agents[view]?.name ?? ''} 知道的事实`} · LLM 延迟 P95 {llm.p95LatencyMs}ms
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex w-[430px] shrink-0 flex-col border-l border-slate-800 bg-slate-900">
          {/* Agent cards */}
          <div className="grid grid-cols-3 gap-2 border-b border-slate-800 p-2">
            {Object.values(world.agents).map((a) => (
              <button
                key={a.id}
                data-testid={`card-${a.id}`}
                onClick={() => setSelected(a.id)}
                className={`rounded-lg border p-2 text-left text-xs transition ${selected === a.id ? 'border-amber-500 bg-slate-800' : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'} ${!a.isAlive ? 'opacity-50' : ''}`}
              >
                <div className="font-bold">{a.isAlive ? a.name : `${a.name}（死亡）`}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 text-[10px] text-slate-300">
                  <span>💧{Math.round(a.needs.water)}</span>
                  <span>🍗{Math.round(a.needs.food)}</span>
                  <span>⚡{Math.round(a.needs.stamina)}</span>
                  <span>❤️{Math.round(a.needs.health)}</span>
                </div>
                <div className="mt-1 truncate text-[10px] text-sky-300">{actionLabel(a)}</div>
                <div className="text-[10px] text-slate-400">水{a.inventory.water} 食{a.inventory.food}</div>
              </button>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-800 px-2 py-1 text-xs">
            {(
              [
                ['overview', '角色洞察'],
                ['events', '事件流'],
                ['relations', '关系三角'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded px-2 py-1 ${tab === k ? 'bg-slate-700 font-bold' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'overview' && selected && <InspectorPanel world={world} agentId={selected} view={view} />}
            {tab === 'events' && <EventStream world={world} view={view} />}
            {tab === 'relations' && <RelationshipTriangle world={world} view={view} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// @pixi/react's Stage throws during unmount teardown in some versions
// (destroying the app while the viewport plugin is half-destroyed).
// The error is benign (the Stage is being removed anyway), so swallow it here
// to keep the page free of uncaught errors (REL-004).
class PixiBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  componentDidCatch(err: unknown) {
    console.warn('[pixi] stage teardown warning (ignored):', err);
    this.setState({ failed: true });
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function actionLabel(a: ClientWorld['agents'][string]): string {
  const act = a.currentAction?.action;
  if (!act) return a.isAlive ? '空闲' : '—';
  switch (act.type) {
    case 'move': return `→ ${act.targetId}`;
    case 'harvest': return `采集 ${act.targetId}`;
    case 'talk': return `交谈 ${act.targetId}`;
    case 'rest': return '休息';
    case 'explore': return `探索 ${act.targetId}`;
    case 'consume': return act.resource === 'water' ? '喝水' : '进食';
    case 'give': return `赠予 ${act.targetId}`;
    case 'store': return '存入';
    case 'take': return '取用';
    case 'loot_backpack': return '拾取背包';
    default: return '未知动作';
  }
}
