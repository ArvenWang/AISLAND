// MVP2 client: typed API + WebSocket subscription for the playable MVP2 UI.
import type { Mvp2ClientWorld } from '../../server/mvp2/api';

export type { Mvp2ClientWorld };

export type HealthInfo = {
  ok: boolean;
  provider: string;
  mode: string;
  model: string;
  apiKeyConfigured: boolean;
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

export const mvp2Api = {
  health: () => request<HealthInfo>('/api/health'),
  createWorld: (seed?: number) =>
    request<{ worldId: string; status: string; seed: number; mode: string }>('/api/mvp2/worlds', {
      method: 'POST',
      body: JSON.stringify(seed !== undefined ? { seed } : {}),
    }),
  getWorld: (worldId: string) => request<{ world: Mvp2ClientWorld }>(`/api/mvp2/worlds/${worldId}`),
  control: (worldId: string, action: 'pause' | 'resume', timeScale?: number) =>
    request<{ ok: boolean; status: string; timeScale?: number }>(`/api/mvp2/worlds/${worldId}/control`, {
      method: 'POST',
      body: JSON.stringify(timeScale !== undefined ? { action: 'speed', timeScale } : { action }),
    }),
  exportUrl: (worldId: string) => `/api/mvp2/worlds/${worldId}/export`,
};

export function subscribeMvp2World(worldId: string, onState: (world: Mvp2ClientWorld) => void, onError?: (e: Error) => void): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`${proto}://${location.host}/ws?worldId=${worldId}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type: string; world?: Mvp2ClientWorld };
        if (msg.type === 'state' && msg.world) onState(msg.world);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onerror = () => onError?.(new Error('WebSocket 连接错误'));
    ws.onclose = () => {
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
