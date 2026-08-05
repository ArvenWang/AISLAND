import { useMemo, useState } from 'react';
import type { ClientWorld } from '../../api/client';
import { describeEvent } from '../../../server/llm/planner';
import { formatGameTime } from '../../../server/engine/scenario';
import type { WorldView } from '../../state/useWorld';

const TYPE_FILTERS = ['全部', '资源', '社交', '承诺', '探索', '死亡'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

export function EventStream({ world, view }: { world: ClientWorld; view: WorldView }) {
  const [filter, setFilter] = useState<TypeFilter>('全部');
  const [agentFilter, setAgentFilter] = useState<string>('全部');
  const [expanded, setExpanded] = useState<string | null>(null);

  const events = useMemo(() => {
    const agentView = view !== 'god' ? world.agents[view] : null;
    let list = [...world.events].reverse();
    if (agentFilter !== '全部') list = list.filter((e) => e.actorId === agentFilter || e.targetId === agentFilter);
    if (agentView) list = list.filter((e) => e.observers.includes(agentView.id) || e.actorId === agentView.id || e.targetId === agentView.id);
    if (filter !== '全部') {
      const typeOf = (t: string): TypeFilter =>
        /resource|harvest|store|take|give|consume|loot/.test(t)
          ? '资源'
          : /message|conversation|talk|speech/.test(t) || t.includes('social')
            ? '社交'
            : /promise/.test(t)
              ? '承诺'
              : /explore|discover|location/.test(t)
                ? '探索'
                : /die|death|dead/.test(t)
                  ? '死亡'
                  : '全部';
      list = list.filter((e) => typeOf(e.type) === filter || (filter === '社交' && e.type === 'action_started' && e.payload?.actionType === 'talk'));
    }
    return list.slice(0, 120);
  }, [world.events, filter, agentFilter, view, world.agents]);

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 flex flex-wrap gap-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-2 py-0.5 text-[10px] ${filter === f ? 'bg-amber-500 font-bold text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            {f}
          </button>
        ))}
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="rounded bg-slate-800 px-1 py-0.5 text-[10px]">
          <option value="全部">全部角色</option>
          {Object.values(world.agents).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {events.length === 0 && <div className="py-8 text-center text-xs text-slate-500">没有符合条件的事件</div>}
        {events.map((e) => {
          const isExpanded = expanded === e.eventId;
          return (
            <div key={e.eventId} className={`rounded border-l-2 bg-slate-800/80 p-1.5 ${eventColor(e.type)}`}>
              <button className="block w-full text-left" onClick={() => setExpanded(isExpanded ? null : e.eventId)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-bold text-slate-500">{formatGameTime(e.gameTime)}</span>
                  <span className="text-[9px] text-slate-500">{e.eventId}</span>
                </div>
                <div className="text-[11px] leading-snug text-slate-200">{describeEvent(world, e)}</div>
              </button>
              {isExpanded && (
                <div className="mt-1 border-t border-slate-700 pt-1 text-[10px] text-slate-400">
                  <div>类型：{e.type}</div>
                  <div>观察者：{e.observers.map((o) => world.agents[o]?.name ?? o).join('、')}</div>
                  <div>显著度：{e.salience}/10</div>
                  {Object.keys(e.payload ?? {}).length > 0 && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[9px]">{JSON.stringify(e.payload, null, 1)}</pre>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function eventColor(type: string): string {
  if (/promise_fulfilled|resource_given|location_shared/.test(type)) return 'border-emerald-500';
  if (/promise_broken|reject|agent_died|harvest_failed|diagnostic/.test(type)) return 'border-red-500';
  if (/promise/.test(type)) return 'border-amber-500';
  if (/harvest|resource|store|take|loot/.test(type)) return 'border-sky-500';
  if (/message|conversation/.test(type)) return 'border-violet-500';
  return 'border-slate-600';
}
