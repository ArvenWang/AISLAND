import { useEffect, useState } from 'react';
import { mvp2Api, type HealthInfo } from '../api/mvp2Client';

export default function StartPage({ onCreated }: { onCreated: (worldId: string) => void }) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mvp2Api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await mvp2Api.createWorld();
      onCreated(res.worldId);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const online = health?.ok === true;

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-200 via-amber-100 to-emerald-100 text-slate-800">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mb-2 text-sm font-semibold tracking-widest text-amber-700">AI NATIVE ISLAND · SOCIAL SIMULATION</div>
        <h1 className="mb-3 text-5xl font-black text-slate-900">AI 原生荒岛</h1>
        <p className="mb-10 max-w-xl text-slate-700">
          三名 AI 幸存者被困荒岛五天。稀缺的淡水、私人知识与不同能力将决定他们是合作、囤积、承诺还是背叛。
          你将以全知视角观察每一个真实动机。
        </p>
        <button
          data-testid="start-game"
          onClick={() => void create()}
          disabled={busy || !online}
          className="rounded-xl bg-amber-500 px-10 py-4 text-lg font-bold text-slate-900 shadow-lg transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '正在生成荒岛…' : '开始新游戏'}
        </button>
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-600">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-400'}`} />
          {online ? `AI 服务在线（${health?.model ?? ''}）` : 'AI 服务离线，请稍后再试'}
        </div>
        {error && <div className="mt-4 rounded bg-red-100 px-4 py-2 text-sm text-red-700">{error}</div>}
      </div>
    </div>
  );
}
