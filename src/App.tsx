import { useCallback, useState } from 'react';
import StartPage from './components/StartPage';
import GameView from './components/GameView';
import EndPage from './components/EndPage';
import { useMvp2World } from './state/useMvp2World';

export default function App() {
  const [worldId, setWorldId] = useState<string | null>(null);
  const [showEnd, setShowEnd] = useState(false);
  const { world, connected, view, setView, followAgent, setFollowAgent, error, control } = useMvp2World(worldId);

  const restart = useCallback(() => {
    setWorldId(null);
    setShowEnd(false);
  }, []);

  if (!worldId) {
    return <StartPage onCreated={(id) => setWorldId(id)} />;
  }
  if (!world) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-slate-200">
        <div className="text-center">
          <div className="mb-3 text-lg">正在连接荒岛世界…</div>
          {error && <div className="text-sm text-red-400">{error}</div>}
        </div>
      </div>
    );
  }
  return (
    <>
      <GameView
        world={world}
        connected={connected}
        view={view}
        setView={setView}
        followAgent={followAgent}
        setFollowAgent={setFollowAgent}
        error={error}
        control={control}
        onEnded={() => setShowEnd(true)}
        onRestart={restart}
      />
      {showEnd && world.status === 'ended' && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95">
          <EndPage world={world} onRestart={restart} />
        </div>
      )}
    </>
  );
}
