// Mvp2 API server: playable MVP2 worlds over HTTP + WebSocket, driven by the
// real LLM planner only (PRD 19.6). Replaces the legacy V0.3 API on the same
// port: /api/health, /api/mvp2/worlds, /api/mvp2/worlds/:id, /ws.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { RuntimeMap } from '../engine/map/runtimeMap';
import { createMvp2World } from './world';
import { decideAgents, stepWorldMovement, WORLD_END_TIME } from './engine';
import { RealLlmBrain } from './planner';
import { LlmAdapter } from '../llm/adapter';
import type { Mvp2World, VisualPhase } from './types';

type Mvp2Entry = {
  world: Mvp2World;
  brain: RealLlmBrain;
  timeScale: number;
  busy: boolean;
  deciding: Promise<void> | null;
  lastLight: string;
  acc: number;
  ticker: NodeJS.Timeout | null;
  tickMs: number;
  stepMin: number;
  createdAt: number;
};

export type Mvp2VisualAction = {
  visualActionId: string;
  semanticActionId: string;
  actorId: string;
  type: string;
  phase: VisualPhase | 'idle';
  progress: number;
  startedAt: number;
  commitAt?: number;
  endsAt: number;
  targetEntityId?: string;
};

export type Mvp2ClientWorld = {
  worldId: string;
  seed: number;
  gameTime: number;
  day: number;
  status: Mvp2World['status'];
  endedReason?: string;
  agents: Record<string, {
    id: string;
    name: string;
    x: number;
    y: number;
    facing: { x: number; y: number };
    isAlive: boolean;
    needs: { water: number; food: number; stamina: number; health: number; sleepNeed: number };
    mental: { mentalStability: number; fear: number; socialSafety: number };
    inventory: Record<string, number>;
    carryUsed: number;
    currentAction: Mvp2VisualAction | null;
    sleeping: boolean;
    plan: { longTermGoal: string; currentObjective: string; steps: Array<{ kind: string; description: string }>; stepIndex: number; abortConditions: Array<{ kind: string; description: string }> } | null;
    relationships: Record<string, { trust: number; resentment: number; dependency: number; affinity: number }>;
    stats: { harvested: Record<string, number>; consumed: Record<string, number>; tookUnattended: number };
    decisions: number;
    lastDecisionAction?: string;
    explored: number;
    knownResources: string[];
    heardClaims: string[];
  }>;
  resources: Array<{ id: string; kind: string; x: number; y: number; stock: number; capacity: number }>;
  wrecks: Array<{ wreckId: string; x: number; y: number; searched: boolean }>;
  groundItems: Array<{ itemId: string; kind: string; quantity: number; x: number; y: number }>;
  fires: Array<{ fireId: string; x: number; y: number; state: string; fuel: number }>;
  events: Array<{
    eventId: string;
    gameTime: number;
    type: string;
    actorId?: string;
    targetId?: string;
    payload: Record<string, unknown>;
    visualActionId?: string;
    salience: number;
  }>;
  llm: { calls: number; inputTokens: number; outputTokens: number; p95LatencyMs: number; avgLatencyMs: number };
};

function visualAction(world: Mvp2World, agentId: string): Mvp2VisualAction | null {
  const agent = world.agents[agentId];
  const a = agent.currentAction;
  if (!a) return null;
  const targetEntityId =
    a.target.kind === 'item' ? a.target.itemId :
    a.target.kind === 'agent' ? a.target.agentId :
    a.target.kind === 'resource' ? a.target.resourceId :
    a.target.kind === 'wreck' ? a.target.wreckId :
    a.target.kind === 'fire' ? a.target.fireId : undefined;
  return {
    visualActionId: a.visualActionId,
    semanticActionId: a.actionId,
    actorId: a.actorId,
    type: a.type,
    phase: a.phase,
    progress: Math.round(a.progress * 100) / 100,
    startedAt: a.startedAt,
    commitAt: a.commitAt,
    endsAt: a.endsAt,
    targetEntityId,
  };
}

export function sanitizeMvp2World(world: Mvp2World): Mvp2ClientWorld {
  const latencies = world.llmLedger.map((l) => l.latencyMs).sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1] : 0;
  const avg = latencies.length ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0;
  return {
    worldId: world.worldId,
    seed: world.seed,
    gameTime: world.gameTime,
    day: Math.floor(world.gameTime / 1440) + 1,
    status: world.status,
    endedReason: world.endedReason,
    agents: Object.fromEntries(
      Object.values(world.agents).map((a) => [
        a.id,
        {
          id: a.id,
          name: a.name,
          x: a.x,
          y: a.y,
          facing: a.facing,
          isAlive: a.isAlive,
          needs: { ...a.needs },
          mental: { ...a.mental },
          inventory: { ...a.inventory },
          carryUsed: a.carryUsed,
          currentAction: visualAction(world, a.id),
          sleeping: !!a.sleep?.sleeping,
          plan: a.plan
            ? {
                longTermGoal: a.plan.longTermGoal,
                currentObjective: a.plan.currentObjective,
                steps: a.plan.steps.map((s) => ({ kind: s.kind, description: s.description })),
                stepIndex: a.plan.stepIndex,
                abortConditions: a.plan.abortConditions.map((c) => ({ kind: c.kind, description: c.description })),
              }
            : null,
          relationships: a.relationships,
          stats: { harvested: a.stats.harvested, consumed: a.stats.consumed, tookUnattended: a.stats.tookUnattended },
          decisions: a.decisions,
          lastDecisionAction: a.lastDecisionAction,
          explored: a.cognitive.explored.reduce((s, v) => s + (v === 1 ? 1 : 0), 0),
          knownResources: [...a.knowledge.knownResources],
          heardClaims: [...a.knowledge.claimsHeard],
        },
      ]),
    ),
    resources: Object.values(world.resources).map((r) => ({ id: r.resourceId, kind: r.kind, x: r.x, y: r.y, stock: Math.round(r.stock * 10) / 10, capacity: r.capacity })),
    wrecks: Object.values(world.wrecks).map((wreck) => ({ wreckId: wreck.wreckId, x: wreck.x, y: wreck.y, searched: wreck.searched })),
    groundItems: Object.values(world.groundItems).map((g) => ({ itemId: g.itemId, kind: g.kind, quantity: g.quantity, x: g.x, y: g.y })),
    fires: Object.values(world.fires).map((f) => ({ fireId: f.fireId, x: f.x, y: f.y, state: f.state, fuel: Math.round(f.fuel) })),
    events: world.events.slice(-240).map((e) => ({
      eventId: e.eventId,
      gameTime: e.gameTime,
      type: e.type,
      actorId: e.actorId,
      targetId: e.targetId,
      payload: e.payload,
      visualActionId: e.visualActionId,
      salience: e.salience,
    })),
    llm: {
      calls: world.llmLedger.length,
      inputTokens: world.llmLedger.reduce((s, l) => s + l.tokenUsage.input, 0),
      outputTokens: world.llmLedger.reduce((s, l) => s + l.tokenUsage.output, 0),
      p95LatencyMs: Math.round(p95),
      avgLatencyMs: Math.round(avg),
    },
  };
}

function makeBrain() {
  const scenario = {
    seed: 1,
    llm: {
      provider: process.env.LLM_PROVIDER ?? 'deepseek',
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      mode: 'real',
      temperature: 0.6,
      maxTokens: 900,
      timeoutMs: 25000,
      injectInvalidJsonRate: 0,
      injectTimeoutRate: 0,
      inject429Rate: 0,
    },
  };
  const adapter = new LlmAdapter(scenario as never);
  return new RealLlmBrain(adapter as never);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export class Mvp2ApiServer {
  private entries = new Map<string, Mvp2Entry>();
  private clients = new Map<string, Set<WebSocket>>();

  constructor(private port: number, private staticDir?: string) {}

  start(): void {
    const server = createServer((req, res) => void this.handleHttp(req, res));
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => this.handleWs(ws, req));
    server.listen(this.port, () => {
      console.log(`[mvp2] API server listening on http://localhost:${this.port}`);
    });
  }

  private handleWs(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const worldId = url.searchParams.get('worldId') ?? '';
    const entry = this.entries.get(worldId);
    if (!entry) {
      ws.close(4004, 'unknown world');
      return;
    }
    let clients = this.clients.get(worldId);
    if (!clients) {
      clients = new Set();
      this.clients.set(worldId, clients);
    }
    clients.add(ws);
    const send = () => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'state', world: sanitizeMvp2World(entry.world) }));
    };
    ws.on('message', () => send());
    send();
    ws.on('close', () => {
      clients?.delete(ws);
    });
  }

  private broadcast(worldId: string): void {
    // Clients poll via WS message or the /api/mvp2/worlds/:id endpoint;
    // for simplicity the server pushes on a shared channel via a singleton
    // registry (see below).
    void worldId;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    try {
      if (path === '/api/health') {
        this.json(res, {
          ok: true,
          provider: process.env.LLM_PROVIDER ?? 'deepseek',
          mode: 'real',
          model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
          apiKeyConfigured: Boolean(process.env.LLM_API_KEY),
          worlds: this.entries.size,
        });
        return;
      }
      if (path === '/api/mvp2/worlds' && req.method === 'POST') {
        if (!process.env.LLM_API_KEY) {
          this.json(res, { error: '真实 LLM API 尚未配置，无法开始游戏。' }, 503);
          return;
        }
        const body = await readJson(req);
        const seed = typeof body.seed === 'number' ? body.seed : Math.floor(Math.random() * 1e6);
        const worldId = `mvp2_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
        const world = createMvp2World(worldId, seed, RuntimeMap.loadDefault());
        const brain = makeBrain();
        const entry: Mvp2Entry = { world, brain, timeScale: 1, busy: false, deciding: null, lastLight: 'day', acc: 0, ticker: null, tickMs: 250, stepMin: 5, createdAt: Date.now() };
        this.entries.set(worldId, entry);
        this.startTicker(entry);
        this.json(res, { worldId, status: world.status, seed, mode: 'real' }, 201);
        return;
      }
      if (path === '/api/mvp2/worlds' && req.method === 'GET') {
        this.json(res, { worlds: [...this.entries.values()].map((e) => ({ worldId: e.world.worldId, seed: e.world.seed, status: e.world.status, gameTime: e.world.gameTime })) });
        return;
      }
      const match = path.match(/^\/api\/mvp2\/worlds\/([^/]+)(?:\/([^/]+))?$/);
      if (match) {
        const worldId = match[1];
        const action = match[2];
        const entry = this.entries.get(worldId);
        if (!entry) return this.notFound(res, 'world not found');
        if (!action && req.method === 'GET') {
          this.json(res, { world: sanitizeMvp2World(entry.world) });
          return;
        }
        if (action === 'control' && req.method === 'POST') {
          const body = await readJson(req);
          const op = String(body.action ?? '');
          if (op === 'pause') {
            entry.world.status = 'paused';
            this.stopTicker(entry);
          } else if (op === 'resume') {
            if (entry.world.status === 'ended') return this.json(res, { ok: false, status: 'ended' });
            entry.world.status = 'running';
            this.startTicker(entry);
          } else if (op === 'speed' && typeof body.timeScale === 'number') {
            entry.timeScale = Math.max(0.5, Math.min(600, body.timeScale));
          }
          // Control changes are authoritative state too. Push immediately;
          // pause stops the ticker, so waiting for a later simulation tick
          // would leave the client HUD permanently showing the old status.
          this.push(worldId);
          this.json(res, { ok: true, status: entry.world.status, timeScale: entry.timeScale });
          return;
        }
        if (action === 'export' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="${worldId}.json"`);
          res.end(JSON.stringify(entry.world, null, 1));
          return;
        }
      }
      if (this.staticDir && (path === '/' || !path.startsWith('/api/'))) {
        this.serveStatic(res, path);
        return;
      }
      this.notFound(res, 'not found');
    } catch (e) {
      this.json(res, { error: (e as Error).message }, 400);
    }
  }

  private serveStatic(res: ServerResponse, pathName: string): void {
    const file = pathName === '/' ? 'index.html' : pathName.replace(/^\//, '');
    const full = normalize(join(this.staticDir ?? '.', file));
    if (!full.startsWith(normalize(this.staticDir ?? '.'))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!existsSync(full)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.end(readFileSync(full));
  }

  private startTicker(entry: Mvp2Entry): void {
    if (entry.ticker) return;
    entry.ticker = setInterval(() => void this.tickOnce(entry), entry.tickMs);
    entry.ticker.unref?.();
  }

  private stopTicker(entry: Mvp2Entry): void {
    if (entry.ticker) clearInterval(entry.ticker);
    entry.ticker = null;
  }

  private async tickOnce(entry: Mvp2Entry): Promise<void> {
    if (entry.world.status !== 'running' || entry.busy) return;
    entry.busy = true;
    try {
      entry.acc += entry.timeScale;
      const steps = Math.floor(entry.acc);
      if (steps < 1) return;
      entry.acc -= steps;
      for (let i = 0; i < steps; i++) {
        if (entry.world.status !== 'running' || entry.world.gameTime >= WORLD_END_TIME) {
          if (entry.world.status === 'running' && entry.world.gameTime >= WORLD_END_TIME) {
            entry.world.status = 'ended';
            entry.world.endedReason = 'time_limit';
          }
          break;
        }
        // Movement/needs/environment step: synchronous, never blocks on LLM.
        entry.lastLight = stepWorldMovement(entry.world, entry.stepMin);
      }
      this.push(entry.world.worldId);
      // Decisions run out-of-band: LLM latency must not stall movement ticks.
      if (!entry.deciding) {
        entry.deciding = decideAgents(entry.world, entry.brain, entry.lastLight)
          .catch((e) => console.error(`[mvp2] decision error in ${entry.world.worldId}:`, e))
          .finally(() => {
            entry.deciding = null;
            this.push(entry.world.worldId);
          });
      }
    } finally {
      entry.busy = false;
    }
  }

  private push(worldId: string): void {
    const clients = this.clients.get(worldId);
    if (!clients || clients.size === 0) return;
    const entry = this.entries.get(worldId);
    if (!entry) return;
    const payload = JSON.stringify({ type: 'state', world: sanitizeMvp2World(entry.world) });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  private json(res: ServerResponse, body: unknown, code = 200): void {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private notFound(res: ServerResponse, msg: string): void {
    this.json(res, { error: msg }, 404);
  }
}
