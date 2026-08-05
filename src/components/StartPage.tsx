import { useEffect, useState } from 'react';
import { api, type HealthInfo } from '../api/client';
import { FIXTURES } from '../../server/engine/scenario';
import type { FixtureId } from '../../server/engine/types';

const FIXTURE_ORDER: FixtureId[] = [
  'FX-BASE',
  'FX-WATER-SECRET',
  'FX-DEPENDENCY',
  'FX-CONTENTION',
  'FX-PROMISE-CRISIS',
  'FX-DEATH-BAG',
  'FX-LLM-INVALID',
  'FX-LLM-LATENCY',
];

export default function StartPage({ onCreated }: { onCreated: (worldId: string) => void }) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [fixture, setFixture] = useState<FixtureId>('FX-BASE');
  const [seed, setSeed] = useState<string>('101');
  const [mode, setMode] = useState<'real' | 'mock'>('real');
  const [timeScale, setTimeScale] = useState<number>(1);
  const [model, setModel] = useState<string>('deepseek-v4-flash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const SPEEDS = [1, 2, 4, 30, 120, 240];

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createWorld({
        fixture,
        seed: Number(seed) || 101,
        mode,
        timeScale,
        model,
      });
      await api.control(res.worldId, 'start');
      onCreated(res.worldId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-200 via-amber-100 to-emerald-100 text-slate-800">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-10">
        <div className="mb-2 text-sm font-semibold tracking-widest text-amber-700">AI NATIVE ISLAND · SOCIAL SIMULATION</div>
        <h1 className="mb-2 text-4xl font-black text-slate-900">AI 原生荒岛</h1>
        <p className="mb-8 max-w-2xl text-slate-700">
          三名 AI 幸存者被困荒岛五天。稀缺的淡水、私人知识与不同能力将决定他们是合作、囤积、承诺还是背叛。
          你将以全知视角观察每一个真实动机。
        </p>

        <div className="grid gap-5 md:grid-cols-[1fr_260px]">
          <div className="rounded-xl border border-slate-300 bg-white/80 p-5 shadow-sm">
            <div className="mb-3 text-sm font-bold text-slate-600">场景（Fixture）</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {FIXTURE_ORDER.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFixture(f);
                    setSeed(String(FIXTURES[f].seed));
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                    fixture === f
                      ? 'border-amber-500 bg-amber-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-400'
                  }`}
                >
                  <div className="font-semibold">{f}</div>
                  <div className="text-xs text-slate-500">{FIXTURES[f].description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-slate-300 bg-white/80 p-5 shadow-sm">
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-600">随机种子</label>
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-600">API 模式</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'real' | 'mock')} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="real">真实 API（DeepSeek）</option>
                <option value="mock">确定性模拟（无 API）</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-600">模型</label>
              <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-600">速度（1x ≈ 25 分钟/局）</label>
              <select value={timeScale} onChange={(e) => setTimeScale(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s === 1 ? '1x 真实速度' : s === 4 ? '4x（验收用）' : s === 240 ? '240x 极速（测试）' : `${s}x`}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
              {health ? (
                <>
                  <div>后端：{health.ok ? '在线' : '离线'}</div>
                  <div>Provider：{health.provider} · {health.mode}</div>
                  <div>模型：{health.model}</div>
                  <div>API Key：{health.apiKey}</div>
                </>
              ) : (
                <div>正在检查后端连接…</div>
              )}
            </div>
            {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">{error}</div>}
            <button
              onClick={create}
              disabled={busy || !health?.ok}
              className="rounded-lg bg-amber-600 px-4 py-3 font-bold text-white shadow transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {busy ? '创建中…' : '开始荒岛实验'}
            </button>
          </div>
        </div>
        <div className="mt-6 text-xs text-slate-500">
          版本：V0.1 Demo · 基于 AI Town（MIT）与 Concordia 设计模式 · 单局 5 个岛上日
        </div>
      </div>
    </div>
  );
}
