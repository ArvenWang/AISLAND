// HTTP + WebSocket API server: world lifecycle, state sync, export, fault injection.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { SimulationEngine } from '../engine/engine';
import { LlmAdapter, formatKeyFingerprint } from '../llm/adapter';
import { createWorld } from '../engine/world';
import type { FixtureId, ScenarioConfig, WorldState } from '../engine/types';
import {
  buildExportBundle,
  ensureWorldsDir,
  listWorlds,
  loadWorld,
  saveWorld,
} from '../save/persistence';

type EngineEntry = {
  engine: SimulationEngine;
  createdAt: number;
  lastSaveMs: number;
};

export class ApiServer {
  private engines = new Map<string, EngineEntry>();
  private wss: WebSocketServer | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private port: number, private staticDir?: string) {
    ensureWorldsDir();
  }

  start(): void {
    const server = createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleWs(ws, req));
    server.listen(this.port, () => {
      console.log(`[island] API server listening on http://localhost:${this.port}`);
    });
    this.saveTimer = setInterval(() => this.autoSave(), 15000);
    this.saveTimer.unref?.();
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    if (path.startsWith('/api/')) {
      console.log(`[api] ${req.method} ${path}`);
    }
    try {
      if (path === '/api/health') {
        this.json(res, {
          ok: true,
          provider: process.env.LLM_PROVIDER ?? 'deepseek',
          mode: process.env.LLM_MODE ?? 'real',
          model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
          apiKey: formatKeyFingerprint(process.env.LLM_API_KEY),
          worlds: this.engines.size,
        });
        return;
      }
      if (path === '/api/worlds' && req.method === 'GET') {
        this.json(res, { worlds: [...listWorlds(), ...this.runningWorldMeta()] });
        return;
      }
      if (path === '/api/worlds' && req.method === 'POST') {
        const body = await readJson(req);
        const fixture = (body.fixture ?? 'FX-BASE') as FixtureId;
        const seed = typeof body.seed === 'number' ? body.seed : undefined;
        const llmMode = (body.mode ?? process.env.LLM_MODE ?? 'real') as ScenarioConfig['llm']['mode'];
        const timeScale = typeof body.timeScale === 'number' ? body.timeScale : 1;
        const worldId = `w_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
        const { world } = createWorld(worldId, fixture, { seed, timeScale }, llmMode);
        world.scenario.llm.model = (body.model as string) ?? process.env.LLM_MODEL ?? world.scenario.llm.model;
        const engine = new SimulationEngine(world, new LlmAdapter(world.scenario));
        engine.onStateChange = (w) => this.broadcastWorld(w);
        engine.onEnded = (w) => {
          saveWorld(w);
          this.broadcastWorld(w);
        };
        this.engines.set(worldId, { engine, createdAt: Date.now(), lastSaveMs: Date.now() });
        this.json(res, { worldId, status: world.status, scenario: { fixture, seed: world.scenario.seed, model: world.scenario.llm.model, promptVersion: world.scenario.promptVersion, mode: llmMode } }, 201);
        return;
      }
      const worldMatch = path.match(/^\/api\/worlds\/([^/]+)(?:\/([^/]+))?$/);
      if (worldMatch) {
        const worldId = worldMatch[1];
        const action = worldMatch[2];
        if (!action && req.method === 'GET') {
          const entry = this.getEntry(worldId);
          if (!entry) return this.notFound(res, 'world not found');
          this.json(res, { world: sanitizeForClient(entry.engine.world) });
          return;
        }
        if (action === 'start' && req.method === 'POST') {
          const entry = this.getEntry(worldId);
          if (!entry) return this.notFound(res, 'world not found');
          entry.engine.start();
          this.json(res, { ok: true, status: entry.engine.world.status });
          return;
        }
        if (action === 'control' && req.method === 'POST') {
          const entry = this.getEntry(worldId);
          if (!entry) return this.notFound(res, 'world not found');
          const body = await readJson(req);
          const op = body.action as string;
          if (op === 'pause') entry.engine.pause();
          else if (op === 'resume') entry.engine.resume();
          else if (op === 'speed' && typeof body.timeScale === 'number') {
            entry.engine.world.scenario.timeScale = Math.max(0.5, Math.min(600, body.timeScale));
          }
          else if (op === 'end') {
            entry.engine.stop();
            entry.engine['finalize']();
          }
          saveWorld(entry.engine.world);
          entry.lastSaveMs = Date.now();
          this.broadcastWorld(entry.engine.world);
          this.json(res, { ok: true, status: entry.engine.world.status });
          return;
        }
        if (action === 'debug' && req.method === 'POST') {
          const entry = this.getEntry(worldId);
          if (!entry) return this.notFound(res, 'world not found');
          const body = await readJson(req);
          if (body.failNext429) entry.engine.adapter.failNextWith429 = true;
          if (body.failNextTimeout) entry.engine.adapter.failNextWithTimeout = true;
          this.json(res, { ok: true });
          return;
        }
        if (action === 'export' && req.method === 'GET') {
          const entry = this.getEntry(worldId);
          if (!entry) return this.notFound(res, 'world not found');
          const bundle = buildExportBundle(entry.engine.world);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="${worldId}-bundle.json"`);
          res.end(JSON.stringify(bundle, null, 2));
          return;
        }
      }
      if (path.startsWith('/api/')) return this.notFound(res, 'unknown api');

      // Static frontend (production build).
      if (this.staticDir) {
        this.serveStatic(url, res);
        return;
      }
      this.json(res, { ok: true, message: 'AI Native Island API. Frontend is served by Vite in dev mode.' });
    } catch (err) {
      console.error('[island] request error', err);
      this.json(res, { ok: false, error: String(err) }, 500);
    }
  }

  private serveStatic(url: URL, res: ServerResponse): void {
    const dir = this.staticDir!;
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const filePath = normalize(join(dir, rel));
    if (!filePath.startsWith(normalize(dir))) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      // SPA fallback.
      const idx = join(dir, 'index.html');
      if (existsSync(idx)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(readFileSync(idx));
      } else {
        res.writeHead(404);
        res.end('not found');
      }
      return;
    }
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.mp3': 'audio/mpeg',
    };
    res.setHeader('Content-Type', types[extname(filePath)] ?? 'application/octet-stream');
    res.end(readFileSync(filePath));
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  private handleWs(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/ws', `http://${req.headers.host ?? 'localhost'}`);
    const worldId = url.searchParams.get('worldId');
    (ws as WebSocket & { worldId?: string }).worldId = worldId ?? undefined;
    if (process.env.ACCEPTANCE_MODE === 'true') {
      const entry = worldId ? this.engines.get(worldId) : undefined;
      console.log(`[ws-connect] worldId=${worldId} t=${entry ? Math.round(entry.engine.world.gameTime) : 'n/a'}`);
    }
    ws.send(JSON.stringify({ type: 'hello', worldId }));
    if (worldId) {
      const entry = this.engines.get(worldId);
      if (entry) ws.send(JSON.stringify({ type: 'state', world: sanitizeForClient(entry.engine.world) }));
    }
    ws.on('error', () => undefined);
  }

  private broadcastWorld(world: WorldState): void {
    if (!this.wss) return;
    if ((process.env.LOG_LLM_PAYLOADS === 'true' || process.env.ACCEPTANCE_MODE === 'true') && world.gameTime % 100 < 5) {
      console.log(`[bcast] ${world.worldId} t=${Math.round(world.gameTime)} status=${world.status}`);
    }
    const payload = JSON.stringify({ type: 'state', worldId: world.worldId, world: sanitizeForClient(world) });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN && (client as WebSocket & { worldId?: string }).worldId === world.worldId) {
        client.send(payload);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getEntry(worldId: string): EngineEntry | null {
    return this.engines.get(worldId) ?? null;
  }

  private runningWorldMeta() {
    return [...this.engines.entries()].map(([worldId, e]) => ({
      worldId,
      status: e.engine.world.status,
      gameTime: e.engine.world.gameTime,
      fixture: e.engine.world.scenario.fixture,
      seed: e.engine.world.scenario.seed,
    }));
  }

  private autoSave(): void {
    const now = Date.now();
    for (const [_worldId, e] of this.engines) {
      if (now - e.lastSaveMs > 15000 || e.engine.world.status === 'ended') {
        saveWorld(e.engine.world);
        e.lastSaveMs = now;
      }
    }
  }

  private json(res: ServerResponse, data: unknown, status = 200): void {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(status);
    res.end(JSON.stringify(data));
  }

  private notFound(res: ServerResponse, message: string): void {
    this.json(res, { ok: false, error: message }, 404);
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1e6) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeForClient(world: WorldState) {
  const { rng: _rng, operationIds: _operationIds, ...rest } = world as WorldState & { rng?: unknown };
  void rng;
  return {
    ...rest,
    operationIds: [...world.operationIds],
    events: world.events.slice(-400),
    rngState: world.rng.stateValue,
  };
}

export function loadExistingWorlds(port: number, staticDir?: string): ApiServer {
  const server = new ApiServer(port, staticDir);
  for (const meta of listWorlds()) {
    const world = loadWorld(meta.worldId);
    if (!world) continue;
    // Recreate engines for loaded worlds but keep them paused until user resumes.
    if (world.status === 'running') world.status = 'paused';
    const engine = new SimulationEngine(world, new LlmAdapter(world.scenario));
    engine.onStateChange = (w) => server['broadcastWorld'](w);
    engine.onEnded = (w) => {
      saveWorld(w);
      server['broadcastWorld'](w);
    };
    server['engines'].set(meta.worldId, { engine, createdAt: Date.now(), lastSaveMs: Date.now() });
  }
  return server;
}
