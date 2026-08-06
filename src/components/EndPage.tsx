import type { Mvp2ClientWorld } from '../api/mvp2Client';

export default function EndPage({ world, onRestart }: { world: Mvp2ClientWorld; onRestart: () => void }) {
  const agents = Object.values(world.agents);
  const alive = agents.filter((a) => a.isAlive).length;
  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <div className="mb-1 text-xs font-bold tracking-widest text-amber-500">AI NATIVE ISLAND · RUN COMPLETE</div>
        <h1 className="mb-2 text-3xl font-black">荒岛实验结束</h1>
        <div className="mb-6 text-sm text-slate-400">
          第 {world.day} 日 · 幸存 {alive}/3 · {world.endedReason === 'all_dead' ? '全员未能幸存' : world.endedReason === 'time_limit' ? '到达第五日黄昏' : world.endedReason}
        </div>
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          {agents.map((a) => (
            <div key={a.id} className={`rounded-xl border p-4 ${a.isAlive ? 'border-emerald-800 bg-emerald-950/40' : 'border-red-900 bg-red-950/30'}`}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-lg font-bold">{a.name}</span>
                <span className="text-xs">{a.isAlive ? `幸存 · 健康 ${Math.round(a.needs.health)}` : '死亡'}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-300">
                <span>采集 水{a.stats.harvested.water ?? 0}/食{a.stats.harvested.food ?? 0}</span>
                <span>消费 水{a.stats.consumed.water ?? 0}/食{a.stats.consumed.food ?? 0}</span>
                <span>决策 {a.decisions} 次</span>
                <span>探索 {a.explored} 格</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-400">
                最后随身：{Object.entries(a.inventory).map(([k, v]) => `${k}×${v}`).join('、') || '无'}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-300">
          <div className="mb-1 font-bold text-slate-200">本局证据</div>
          <div>LLM 调用 {world.llm.calls} 次 · 输入 {world.llm.inputTokens} tok · 输出 {world.llm.outputTokens} tok</div>
          <div>
            完整事件/轨迹：<a href={`/api/mvp2/worlds/${world.worldId}/export`} download className="text-sky-300 underline">导出证据包</a>
          </div>
        </div>
        <button onClick={onRestart} className="mt-6 rounded-xl bg-amber-500 px-8 py-3 font-bold text-slate-900 hover:bg-amber-400" data-testid="btn-restart-end">
          再开一局
        </button>
      </div>
    </div>
  );
}
