import { useEffect, useRef, useState } from 'react';
import { api, subscribeWorld, type ClientWorld } from '../api/client';

export type WorldView = 'god' | 'agent_a' | 'agent_b' | 'agent_c';

export function useWorld(worldId: string | null) {
  const [world, setWorld] = useState<ClientWorld | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<WorldView>('god');
  const [error, setError] = useState<string | null>(null);
  const worldRef = useRef<ClientWorld | null>(null);
  const lastTimeRef = useRef<number>(-1);
  worldRef.current = world;

  useEffect(() => {
    if (!worldId) return;
    let disposed = false;
    api
      .getWorld(worldId)
      .then(({ world: w }) => {
        if (!disposed) {
          if ((window as unknown as { __wsDebug?: boolean }).__wsDebug) {
            console.log('[rest]', w.worldId, Math.round(w.gameTime), 'status', w.status);
          }
          setWorld(w);
          setConnected(true);
        }
      })
      .catch((e: Error) => !disposed && setError(e.message));
    const cleanup = subscribeWorld(
      worldId,
      (w) => {
        if ((window as unknown as { __wsDebug?: boolean }).__wsDebug) {
          console.log('[setWorld]', w.worldId, Math.round(w.gameTime), 'status', w.status);
          if (lastTimeRef.current > w.gameTime + 1) {
            console.log('[STALE-DETECT]', 'prev', Math.round(lastTimeRef.current), 'new', Math.round(w.gameTime));
          }
          lastTimeRef.current = w.gameTime;
        }
        setWorld(w);
        setConnected(true);
      },
      (e) => setError(e.message),
    );
    return () => {
      disposed = true;
      cleanup();
    };
  }, [worldId]);

  const control = async (action: 'start' | 'pause' | 'resume' | 'end') => {
    if (!worldId) return;
    await api.control(worldId, action);
  };

  return { world, connected, view, setView, error, control };
}
