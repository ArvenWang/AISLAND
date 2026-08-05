import { useMemo, useState } from 'react';
import type { ClientWorld } from '../../api/client';
import { formatGameTime } from '../../../server/engine/scenario';
import type { WorldView } from '../../state/useWorld';

const POS: Record<string, { x: number; y: number }> = {
  agent_a: { x: 130, y: 26 },
  agent_b: { x: 22, y: 148 },
  agent_c: { x: 238, y: 148 },
};

export function RelationshipTriangle({ world, view }: { world: ClientWorld; view: WorldView }) {
  const [selectedPair, setSelectedPair] = useState<[string, string] | null>(null);
  const ids = Object.keys(world.agents);
  const pairs: Array<[string, string]> = [
    [ids[0], ids[1]],
    [ids[0], ids[2]],
    [ids[1], ids[2]],
  ];

  const agentView = view !== 'god' ? world.agents[view] : null;
  const visible = (id: string) => (agentView ? id === agentView.id || Math.abs(agentView.relationships[id]?.trust ?? 0) > 5 : true);

  const curve = useMemo(() => {
    if (!selectedPair) return null;
    const [a, b] = selectedPair;
    const hist = world.relationshipHistory[a]?.[b] ?? [];
    const histB = world.relationshipHistory[b]?.[a] ?? [];
    const points = hist.map((h, i) => ({ t: h.gameTime, trust: h.trust, resentment: h.resentment, bTrust: histB[i]?.trust ?? h.trust }));
    return points;
  }, [selectedPair, world.relationshipHistory]);

  return (
    <div className="p-3">
      <div className="mb-1 text-xs font-bold text-slate-300">关系三角（信任/怨恨/依赖）</div>
      <div className="text-[10px] text-slate-500">点击边查看数值曲线与来源事件；箭头方向为“谁对谁”的信任。</div>
      <svg viewBox="0 0 260 180" className="mt-1 w-full rounded bg-slate-800">
        {pairs.map(([a, b], i) => {
          const pa = POS[a];
          const pb = POS[b];
          const relA = world.agents[a].relationships[b];
          const relB = world.agents[b].relationships[a];
          const visibleEdge = visible(a) && visible(b);
          const trustColor = (v: number) => (v >= 20 ? '#34d399' : v <= -20 ? '#f87171' : '#94a3b8');
          const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
          const off = i === 0 ? { x: 0, y: -10 } : i === 1 ? { x: 8, y: 5 } : { x: -8, y: 5 };
          return (
            <g key={i} onClick={() => visibleEdge && setSelectedPair([a, b])} className={visibleEdge ? 'cursor-pointer' : 'opacity-30'}>
              <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={trustColor(relA.trust)} strokeWidth={1 + Math.abs(relA.trust) / 25} opacity={0.7} />
              <line x1={pb.x} y1={pb.y} x2={pa.x} y2={pa.y} stroke={trustColor(relB.trust)} strokeWidth={1 + Math.abs(relB.trust) / 25} opacity={0.7} strokeDasharray="4 3" />
              <text x={mid.x + off.x} y={mid.y + off.y} textAnchor="middle" fontSize={9} fill="#e2e8f0">
                {Math.round(relA.trust)} / {Math.round(relB.trust)} · 怨{Math.round(relA.resentment)}
              </text>
            </g>
          );
        })}
        {ids.map((id) => (
          <g key={id} className={visible(id) ? '' : 'opacity-30'}>
            <circle cx={POS[id].x} cy={POS[id].y} r={16} fill="#334155" stroke="#f59e0b" strokeWidth={2} />
            <text x={POS[id].x} y={POS[id].y + 3} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#fff">
              {world.agents[id].name.slice(0, 2)}
            </text>
            {!world.agents[id].isAlive && (
              <text x={POS[id].x} y={POS[id].y + 26} textAnchor="middle" fontSize={8} fill="#f87171">
                死亡
              </text>
            )}
          </g>
        ))}
      </svg>

      {curve && curve.length > 1 && (
        <div className="mt-2 rounded bg-slate-800 p-2">
          <div className="mb-1 text-[10px] font-bold">
            {world.agents[selectedPair![0]].name} ↔ {world.agents[selectedPair![1]].name} 信任曲线
          </div>
          <svg viewBox="0 0 300 80" className="w-full">
            {(() => {
              const xs = curve.map((p) => p.t);
              const minT = xs[0];
              const maxT = xs[xs.length - 1];
              const x = (t: number) => ((t - minT) / Math.max(1, maxT - minT)) * 290 + 5;
              const y = (v: number) => 40 - (Math.max(-100, Math.min(100, v)) / 100) * 32;
              const lineA = curve.map((p) => `${x(p.t)},${y(p.trust)}`).join(' ');
              const lineB = curve.map((p) => `${x(p.t)},${y(p.bTrust)}`).join(' ');
              return (
                <>
                  <polyline points={lineA} fill="none" stroke="#34d399" strokeWidth={1.5} />
                  <polyline points={lineB} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="3 2" />
                  <line x1={5} y1={40} x2={295} y2={40} stroke="#475569" strokeWidth={0.5} />
                </>
              );
            })()}
          </svg>
          <div className="flex justify-between text-[9px] text-slate-500">
            <span>{formatGameTime(curve[0].t)}</span>
            <span>绿=对{world.agents[selectedPair![1]].name} · 蓝=对{world.agents[selectedPair![0]].name}</span>
            <span>{formatGameTime(curve[curve.length - 1].t)}</span>
          </div>
        </div>
      )}

      {selectedPair && (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-bold text-slate-400">关系变化依据（source events）</div>
          {world.agents[selectedPair[0]].relationships[selectedPair[1]].deltas
            .slice(-6)
            .reverse()
            .map((d, i) => (
              <div key={i} className="mb-0.5 text-[10px] text-slate-400">
                {formatGameTime(d.gameTime)} [{d.ruleId}] {d.explanation}（{d.delta > 0 ? '+' : ''}{d.delta} {d.field}） → {d.sourceEventId}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
