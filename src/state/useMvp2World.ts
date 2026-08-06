import { useEffect, useRef, useState } from 'react';
import { mvp2Api, subscribeMvp2World, type Mvp2ClientWorld } from '../api/mvp2Client';

export type WorldView = 'god' | 'agent_a' | 'agent_b' | 'agent_c';

export function useMvp2World(worldId: string | null) {
  const [world, setWorld] = useState<Mvp2ClientWorld | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<WorldView>('god');
  const [followAgent, setFollowAgent] = useState<string | null>(null);
  const lastWorld = useRef<Mvp2ClientWorld | null>(null);

  useEffect(() => {
    if (!worldId) return;
    let alive = true;
    setError(null);
    mvp2Api
      .getWorld(worldId)
      .then((r) => {
        if (!alive) return;
        setWorld(r.world);
        lastWorld.current = r.world;
        setConnected(true);
      })
      .catch((e) => alive && setError((e as Error).message));
    const unsub = subscribeMvp2World(
      worldId,
      (w) => {
        if (!alive) return;
        setWorld(w);
        lastWorld.current = w;
        setConnected(true);
      },
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
      unsub();
    };
  }, [worldId]);

  const control = async (action: 'pause' | 'resume', timeScale?: number) => {
    if (!worldId) return;
    try {
      const r = await mvp2Api.control(worldId, action, timeScale);
      if (r.status === 'ended' || r.status === 'running' || r.status === 'paused') {
        setWorld((w) => (w ? { ...w, status: r.status as Mvp2ClientWorld['status'] } : w));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return { world, connected, error, view, setView, followAgent, setFollowAgent, control };
}
