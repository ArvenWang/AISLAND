// MVP2 headless run with the REAL LLM planner. Saves acceptance evidence:
// events.jsonl, api-ledger.json, trajectories.jsonl, summary.json.
// Usage: npx tsx scripts/mvp2-run.ts --seed 101 --days 5 --stepMin 30

import * as fs from 'fs';
import * as path from 'path';
import { config as loadEnv } from 'dotenv';
import { RuntimeMap } from '../server/engine/map/runtimeMap';
import { createMvp2World } from '../server/mvp2/world';
import { stepWorld, WORLD_END_TIME } from '../server/mvp2/engine';
import { RealLlmBrain } from '../server/mvp2/planner';
import { LlmAdapter } from '../server/llm/adapter';

loadEnv();

function parseArgs(): { seed: number; days: number; stepMin: number; outDir: string } {
  const argv = process.argv.slice(2);
  const get = (name: string, def: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  return {
    seed: parseInt(get('seed', String(Math.floor(Math.random() * 1e6))), 10),
    days: parseInt(get('days', '5'), 10),
    stepMin: parseInt(get('stepMin', '30'), 10),
    outDir: get('out', path.join(__dirname, '../acceptance/mvp2/runs')),
  };
}

function makeBrain() {
  const scenario = {
    seed: 1,
    llm: {
      provider: process.env.LLM_PROVIDER ?? 'deepseek',
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      mode: 'real' as const,
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

async function main() {
  const { seed, days, stepMin, outDir } = parseArgs();
  const map = RuntimeMap.loadDefault();
  const world = createMvp2World(`run_${seed}`, seed, map);
  const brain = makeBrain();
  const runId = `run-${seed}-${Date.now().toString(36)}`;
  const dir = path.join(outDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  const trajectories: Array<{ t: number; agents: Array<{ id: string; x: number; y: number; alive: boolean; needs: number[] }> }> = [];

  const endTime = Math.min(WORLD_END_TIME, days * 1440);
  let guard = 0;
  while (world.status === 'running' && world.gameTime < endTime && guard++ < 2000) {
    await stepWorld(world, stepMin, brain);
    trajectories.push({
      t: world.gameTime,
      agents: Object.values(world.agents).map((a) => ({ id: a.id, x: a.x, y: a.y, alive: a.isAlive, needs: [Math.round(a.needs.water), Math.round(a.needs.food), Math.round(a.needs.health)] })),
    });
  }

  fs.writeFileSync(path.join(dir, 'events.jsonl'), world.events.map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(dir, 'api-ledger.json'), JSON.stringify(world.llmLedger, null, 1));
  fs.writeFileSync(path.join(dir, 'trajectories.jsonl'), trajectories.map((t) => JSON.stringify(t)).join('\n'));
  const costs = world.llmLedger.reduce(
    (s, l) => {
      s.input += l.tokenUsage.input;
      s.output += l.tokenUsage.output;
      s.calls++;
      return s;
    },
    { input: 0, output: 0, calls: 0 },
  );
  const summary = {
    runId,
    seed,
    status: world.status,
    endedReason: world.endedReason,
    gameTime: world.gameTime,
    steps: guard,
    api: { ...costs, p95Latency: p95(world.llmLedger.map((l) => l.latencyMs)) },
    agents: Object.values(world.agents).map((a) => ({
      id: a.id,
      alive: a.isAlive,
      x: a.x,
      y: a.y,
      decisions: a.decisions,
      inventory: a.inventory,
      explored: a.cognitive.explored.reduce((s, v) => s + v, 0),
      eventsSeen: world.events.filter((e) => e.observers.includes(a.id)).length,
    })),
    eventTypes: world.events.reduce((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {} as Record<string, number>),
    fires: Object.values(world.fires).length,
    groundItems: Object.values(world.groundItems).length,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ runId, seed, provider: process.env.LLM_PROVIDER ?? 'deepseek', model: process.env.LLM_MODEL ?? 'unknown', createdAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify(summary, null, 1));
}

function p95(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

void main();
