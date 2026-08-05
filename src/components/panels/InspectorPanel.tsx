import { useMemo } from 'react';
import type { ClientWorld } from '../../api/client';
import { getProfile, compileMechanics, renderBiography } from '../../../server/engine/profile';
import { describeEvent } from '../../../server/llm/planner';
import { formatGameTime } from '../../../server/engine/scenario';
import type { WorldView } from '../../state/useWorld';

export function InspectorPanel({ world, agentId, view }: { world: ClientWorld; agentId: string; view: WorldView }) {
  const agent = world.agents[agentId];
  const profile = getProfile(agent.profileId);
  const mech = compileMechanics(profile);
  const isGod = view === 'god';
  const isSelf = view === agentId;

  const memories = useMemo(() => {
    return agent.recentEvents
      .map((eid) => world.events.find((e) => e.eventId === eid))
      .filter((e): e is NonNullable<typeof e> => !!e)
      .slice(-8)
      .reverse();
  }, [agent.recentEvents, world.events]);

  const promises = world.promiseLedger.filter((p) => p.promiserId === agentId || p.recipientId === agentId);

  return (
    <div className="space-y-4 p-3 text-xs">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-bold">{agent.name}</span>
          <span className="text-[10px] text-slate-400">{profile.title}</span>
        </div>
        <p className="mb-2 rounded bg-slate-800 p-2 leading-relaxed text-slate-300">{renderBiography(profile)}</p>
        {!isGod && !isSelf && (
          <div className="rounded bg-amber-900/40 p-2 text-amber-200">认知视角：以下私人动机与参数来自全知数据，仅供玩家对比（角色本身不知道这些）。</div>
        )}
      </div>

      {agent.planDebug && (
        <div className="rounded border border-sky-800 bg-sky-950/50 p-2">
          <div className="mb-1 font-bold text-sky-300">最近一次决策</div>
          <div className="space-y-0.5 text-[11px] text-slate-300">
            <div>决策时刻：{formatGameTime(agent.planDebug.requestedGameTime)} · 延迟 {agent.planDebug.latencyMs}ms</div>
            <div>验证结果：{agent.planDebug.validationResult}</div>
            {agent.planDebug.fallbackUsed && <div className="text-amber-300">已使用备选动作</div>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-1.5">
        {(
          [
            ['💧 口渴', agent.needs.water],
            ['🍗 饥饿', agent.needs.food],
            ['⚡ 体力', agent.needs.stamina],
            ['❤️ 健康', agent.needs.health],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded bg-slate-800 p-1.5 text-center">
            <div className="text-[10px] text-slate-400">{label}</div>
            <div className={`text-sm font-bold ${v < 25 ? 'text-red-400' : v < 50 ? 'text-amber-300' : 'text-emerald-300'}`}>{Math.round(v)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-[10px] text-slate-400">库存 水/食</div>
          <div className="font-bold">{agent.inventory.water} / {agent.inventory.food}</div>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-[10px] text-slate-400">携带上限</div>
          <div className="font-bold">{mech.carryCapacity}</div>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-[10px] text-slate-400">当前策略</div>
          <div className="font-bold text-amber-300">{agent.strategy.label}</div>
        </div>
      </div>

      <div className="rounded bg-slate-800 p-2">
        <div className="mb-1 font-bold">动态状态</div>
        <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-300">
          <span>压力 {Math.round(agent.stress)}</span>
          <span>恐惧 {Math.round(agent.fear)}</span>
          <span>绝望 {Math.round(agent.desperation)}</span>
          <span>稀缺感知 {Math.round(agent.perceivedScarcity)}</span>
          <span>社交安全 {Math.round(agent.socialSecurity)}</span>
          <span>决策次数 {agent.decisionCount}</span>
        </div>
      </div>

      <div className="rounded bg-slate-800 p-2">
        <div className="mb-1 font-bold">稳定参数（Profile）</div>
        <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-[10px] text-slate-300">
          <span>力量 {profile.physical.strength}</span>
          <span>耐力 {profile.physical.endurance}</span>
          <span>行动力 {profile.physical.mobility}</span>
          <span>认路 {profile.skills.navigation}</span>
          <span>观察 {profile.skills.observation}</span>
          <span>找水 {profile.skills.waterFinding}</span>
          <span>采集 {profile.skills.foraging}</span>
          <span>负重 {profile.skills.loadHandling}</span>
          <span>效率 {profile.skills.harvestEfficiency}</span>
          <span>同理 {profile.personality.empathy}</span>
          <span>控制 {profile.personality.dominance}</span>
          <span>风险 {profile.personality.riskTolerance}</span>
          <span>冲动 {profile.personality.impulsivity}</span>
          <span>损失厌恶 {profile.personality.lossAversion}</span>
          <span>冲突回避 {profile.personality.conflictAvoidance}</span>
          <span>诚实 {profile.personality.honestyPreference}</span>
          <span>互惠 {profile.personality.reciprocitySensitivity}</span>
          <span>未来导向 {profile.personality.futureOrientation}</span>
        </div>
      </div>

      <div className="rounded bg-slate-800 p-2">
        <div className="mb-1 font-bold">已知地点（KnownLocations）</div>
        <div className="flex flex-wrap gap-1">
          {agent.knownLocations.map((locId) => (
            <span key={locId} className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px]">
              {world.map.locations.find((l) => l.id === locId)?.name ?? locId}
            </span>
          ))}
        </div>
        {!isGod && !isSelf && (
          <div className="mt-1 text-[10px] text-slate-500">认知视角：未知地点已从地图与选项中隐藏。</div>
        )}
      </div>

      <div className="rounded bg-slate-800 p-2">
        <div className="mb-1 font-bold">对他人的关系</div>
        {Object.entries(agent.relationships).map(([oid, rel]) => (
          <div key={oid} className="mb-1 rounded bg-slate-700/60 p-1.5">
            <div className="font-bold">{world.agents[oid]?.name}</div>
            <div className="grid grid-cols-4 text-[10px] text-slate-300">
              <span>信任 {Math.round(rel.trust)}</span>
              <span>怨恨 {Math.round(rel.resentment)}</span>
              <span>依赖 {Math.round(rel.dependency)}</span>
              <span>亲近 {Math.round(rel.affinity)}</span>
            </div>
            {rel.deltas.slice(-3).reverse().map((d, i) => (
              <div key={i} className="mt-0.5 text-[9px] text-slate-400">
                {formatGameTime(d.gameTime)} {d.explanation}（{d.ruleId} {d.delta > 0 ? '+' : ''}{d.delta} {d.field}）
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="rounded bg-slate-800 p-2">
        <div className="mb-1 font-bold">承诺</div>
        {promises.length === 0 && <div className="text-[10px] text-slate-500">暂无承诺</div>}
        {promises.map((p) => (
          <div key={p.promiseId} className="mb-1 rounded bg-slate-700/60 p-1.5 text-[10px]">
            <span className="font-bold">{world.agents[p.promiserId]?.name}</span> 承诺给 <span className="font-bold">{world.agents[p.recipientId]?.name}</span>{' '}
            {p.amount ?? ''} {p.resource === 'water' ? '水' : p.resource === 'food' ? '食物' : ''}
            {p.locationId ? `地点 ${p.locationId}` : ''} · 截止 {formatGameTime(p.deadline)} ·{' '}
            <span className={p.status === 'fulfilled' ? 'text-emerald-300' : p.status === 'broken' ? 'text-red-300' : 'text-amber-300'}>{p.status}</span>
            {p.statusReason ? `（${p.statusReason}）` : ''}
          </div>
        ))}
      </div>

      <div className="rounded bg-slate-800 p-2">
        <div className="mb-1 font-bold">最近记忆（观察到的事件）</div>
        {memories.length === 0 && <div className="text-[10px] text-slate-500">暂无</div>}
        {memories.map((e) => (
          <div key={e.eventId} className="mb-0.5 text-[10px] text-slate-300">
            <span className="text-slate-500">{formatGameTime(e.gameTime)}</span> {describeEvent(world, e)}
          </div>
        ))}
      </div>

      <div className="rounded bg-slate-800 p-2">
        <div className="mb-1 font-bold">本局统计</div>
        <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300">
          <span>采集：水{agent.stats.harvested.water} 食{agent.stats.harvested.food}</span>
          <span>消费：水{agent.stats.consumed.water} 食{agent.stats.consumed.food}</span>
          <span>赠出：水{agent.stats.given.water} 食{agent.stats.given.food}</span>
          <span>收到：水{agent.stats.received.water} 食{agent.stats.received.food}</span>
          <span>存入公共：{agent.stats.storedToPublic.water + agent.stats.storedToPublic.food}</span>
          <span>取用公共：{agent.stats.takenFromPublic.water + agent.stats.takenFromPublic.food}</span>
          <span>请求 {agent.stats.requestsMade} 次</span>
          <span>拒绝他人 {agent.stats.refusalsMade} 次</span>
          <span>守约 {agent.stats.promisesFulfilled}</span>
          <span>违约 {agent.stats.promisesBroken}</span>
          <span>分享地点 {agent.stats.locationsShared}</span>
          <span>无效动作 {agent.invalidActionStreak}</span>
        </div>
      </div>
    </div>
  );
}
