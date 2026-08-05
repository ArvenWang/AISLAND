import type { ClientWorld } from '../api/client';
import { formatGameTime } from '../../server/engine/scenario';

export default function EndPage({ world, onRestart }: { world: ClientWorld; onRestart: () => void }) {
  const stats = world.finalStats;
  if (!stats) return null;
  const m = stats.metrics;

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-1 text-xs font-bold tracking-widest text-amber-500">AI NATIVE ISLAND · RUN COMPLETE</div>
        <h1 className="mb-1 text-3xl font-black">荒岛实验结束</h1>
        <div className="mb-6 text-sm text-slate-400">
          {stats.endReason} · 结束时 {formatGameTime(stats.endedAt)} · 结局分类：<span className="font-bold text-amber-300">{m.outcomeClass}</span>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          {Object.entries(stats.perAgent).map(([id, p]) => {
            const agent = world.agents[id];
            return (
              <div key={id} className={`rounded-xl border p-4 ${p.alive ? 'border-emerald-800 bg-emerald-950/40' : 'border-red-900 bg-red-950/30'}`}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-lg font-bold">{agent.name}</span>
                  <span className="text-xs">{p.alive ? `幸存 · 健康 ${p.finalHealth}` : '死亡'}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-300">
                  <span>采集 水{p.harvested.water}/食{p.harvested.food}</span>
                  <span>消费 水{p.consumed.water}/食{p.consumed.food}</span>
                  <span>赠出 水{p.given.water}/食{p.given.food}</span>
                  <span>收到 水{p.received.water}/食{p.received.food}</span>
                  <span>存入公共 {p.stored.water + p.stored.food}</span>
                  <span>取用公共 {p.taken.water + p.taken.food}</span>
                  <span>守约 {p.fulfilled}</span>
                  <span>违约 {p.broken}</span>
                  <span>拒绝 {p.refusals} 次</span>
                  <span>分享地点 {p.locationsShared} 次</span>
                </div>
                <div className="mt-2 text-[10px] text-slate-400">发现：{p.locationsDiscovered.join('、') || '无'}</div>
              </div>
            );
          })}
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-2 font-bold">行为指标（结构化证据）</div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="rounded bg-slate-800 p-2">合作事件 <span className="font-bold text-emerald-300">{m.cooperationEvents.length}</span></div>
              <div className="rounded bg-slate-800 p-2">竞争事件 <span className="font-bold text-red-300">{m.competitionEvents.length}</span></div>
              <div className="rounded bg-slate-800 p-2">资源争夺 <span className="font-bold text-amber-300">{m.contentionEvents.length}</span></div>
              <div className="rounded bg-slate-800 p-2">互惠闭环 <span className="font-bold">{m.reciprocityLoops}</span></div>
              <div className="rounded bg-slate-800 p-2">策略转变 <span className="font-bold">{m.strategyShifts.length}</span></div>
              <div className="rounded bg-slate-800 p-2">联盟窗口 <span className="font-bold">{m.allianceWindows.length}</span></div>
              <div className="rounded bg-slate-800 p-2">对话 <span className="font-bold">{m.conversationCount}</span> 次</div>
              <div className="rounded bg-slate-800 p-2">资源浪费率 <span className="font-bold">{Math.round(m.wasteRate * 100)}%</span></div>
              <div className="rounded bg-slate-800 p-2">承诺 {m.promises.total}（守{m.promises.fulfilled}/违{m.promises.broken}/撤{m.promises.cancelled}/不可{m.promises.impossible}）</div>
              <div className="rounded bg-slate-800 p-2">无效动作 <span className="font-bold">{m.invalidActionCount}</span></div>
            </div>
            {m.allianceWindows.length > 0 && (
              <div className="mt-2 text-xs text-slate-300">
                联盟：{m.allianceWindows.map((w) => `${world.agents[w.pair[0]].name}×${world.agents[w.pair[1]].name}（${formatGameTime(w.from)}-${formatGameTime(w.to)}）`).join('；')}
              </div>
            )}
            {m.strategyShifts.length > 0 && (
              <div className="mt-2 text-xs text-slate-300">
                策略转变：{m.strategyShifts.map((s) => `${world.agents[s.agentId].name} ${s.from}→${s.to}（${formatGameTime(s.gameTime)}）`).join('；')}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-2 font-bold">荒岛简史</div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {stats.timeline.map((t) => (
                <div key={t.eventId} className="text-xs text-slate-300">
                  <span className="mr-2 font-mono text-[10px] text-slate-500">{formatGameTime(t.gameTime)}</span>
                  {t.text}
                  <span className="ml-1 text-[9px] text-slate-600">{t.eventId}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400">
          <div className="mb-1 font-bold text-slate-200">LLM 用量</div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            <span>规划 {world.llmUsage.summary.plannerCalls} 次</span>
            <span>对话 {world.llmUsage.summary.dialogueCalls} 次</span>
            <span>修复 {world.llmUsage.summary.repairCalls} 次</span>
            <span>输入 {world.llmUsage.summary.totalPromptTokens} tok</span>
            <span>输出 {world.llmUsage.summary.totalCompletionTokens} tok</span>
            <span>P95 延迟 {world.llmUsage.summary.p95LatencyMs}ms</span>
            <span>估算成本 ${world.llmUsage.summary.totalCostUsd.toFixed(4)}</span>
            <span>模型 {world.scenario.llm.model}</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onRestart} className="rounded-lg bg-amber-600 px-5 py-2.5 font-bold text-white hover:bg-amber-700">
            再来一局（新世界）
          </button>
          <a href={`/api/worlds/${world.worldId}/export`} download className="rounded-lg bg-sky-700 px-5 py-2.5 font-bold text-white hover:bg-sky-600">
            下载验收包（JSON）
          </a>
        </div>
      </div>
    </div>
  );
}
