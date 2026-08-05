import type { FixtureId, WorldState } from '../../server/engine/types';

export type ClientWorld = Omit<WorldState, 'rng' | 'operationIds'> & {
  operationIds: string[];
  rngState: number;
};

export type HealthInfo = {
  ok: boolean;
  provider: string;
  mode: string;
  model: string;
  apiKey: string;
  worlds: number;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  createWorld: (body: { fixture: FixtureId; seed?: number; mode: string; timeScale?: number; model?: string }) =>
    request<{ worldId: string; status: string; scenario: { fixture: string; seed: number; model: string; promptVersion: string; mode: string } }>('/api/worlds', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getWorld: (worldId: string) => request<{ world: ClientWorld }>(`/api/worlds/${worldId}`),
  control: (worldId: string, action: 'start' | 'pause' | 'resume' | 'end') =>
    request<{ ok: boolean; status: string }>(action === 'start' ? `/api/worlds/${worldId}/start` : `/api/worlds/${worldId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  debug: (worldId: string, flags: { failNext429?: boolean; failNextTimeout?: boolean }) =>
    request<{ ok: boolean }>(`/api/worlds/${worldId}/debug`, { method: 'POST', body: JSON.stringify(flags) }),
  exportUrl: (worldId: string) => `/api/worlds/${worldId}/export`,
};

export function subscribeWorld(worldId: string, onState: (world: ClientWorld) => void, onError?: (e: Error) => void): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`${proto}://${location.host}/ws?worldId=${worldId}`);
    if ((window as unknown as { __wsDebug?: boolean }).__wsDebug) {
      console.log('[ws-open]', worldId);
    }
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { type: string; world?: ClientWorld };
      if (msg.type === 'state' && msg.world) {
        if ((window as unknown as { __wsDebug?: boolean }).__wsDebug) {
          console.log('[ws]', msg.world.worldId, Math.round(msg.world.gameTime));
        }
        onState(msg.world);
      }
    } catch {
      // ignore malformed frames
    }
  };
  ws.onerror = () => onError?.(new Error('WebSocket 连接错误'));
  ws.onclose = () => {
    // Auto-reconnect (REL-002).
      if (!closed && document.visibilityState !== 'hidden') {
        retryTimer = setTimeout(connect, 1500);
      }
  };
  };
  connect();
  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    ws?.close();
  };
}

export function downloadExport(worldId: string) {
  window.open(api.exportUrl(worldId), '_blank');
}
