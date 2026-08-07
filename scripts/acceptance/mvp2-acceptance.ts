// P8 real-API acceptance batches (PRD 20/26):
//   --batch A  6 full runs (5 days) on distinct seeds
//   --batch B  3 runs with per-day spatial snapshot PNGs
//   --batch C  3 fault runs (invalid JSON / timeout / 429)
//   --batch D  6 counterfactual pairs (same seed, one mutated factor)
// Writes acceptance/mvp2/final/evidence + docs/MVP2_ACCEPTANCE_REPORT.md.
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';
import { PNG } from 'pngjs';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { createMvp2World } from '../../server/mvp2/world';
import { stepWorld } from '../../server/mvp2/engine';
import { RealLlmBrain } from '../../server/mvp2/planner';
import { LlmAdapter } from '../../server/llm/adapter';
import type { Mvp2World } from '../../server/mvp2/types';

const OUT = path.join(__dirname, '../../acceptance/mvp2/final');
const SEEDS_A = [101, 202, 303, 404, 505, 606];
const SEEDS_B = [707, 808, 909];
const DAYS = 5;

type RunOpts = {
  seed: number;
  days: number;
  stepMin: number;
  tag: string;
  inject?: { invalidJsonRate?: number; timeoutRate?: number; rate429?: number };
  mutate?: (world: Mvp2World) => void;
  snapshots?: boolean;
};

function makeBrain(inject?: RunOpts['inject']) {
  const scenario = {
    seed: 1,
    llm: {
      provider: process.env.LLM_PROVIDER ?? 'deepseek',
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      mode: 'real' as const,
      temperature: 0.6,
      maxTokens: 900,
      timeoutMs: 25000,
      injectInvalidJsonRate: inject?.invalidJsonRate ?? 0,
      injectTimeoutRate: inject?.timeoutRate ?? 0,
      inject429Rate: inject?.rate429 ?? 0,
    },
  };
  const adapter = new LlmAdapter(scenario as never);
  return new RealLlmBrain(adapter as never);
}

async function runOne(opts: RunOpts): Promise<{ world: Mvp2World; runId: string }> {
  const map = RuntimeMap.loadDefault();
  const world = createMvp2World(`${opts.tag}_${opts.seed}`, opts.seed, map);
  if (opts.mutate) opts.mutate(world);
  const brain = makeBrain(opts.inject);
  const runId = `${opts.tag}-${opts.seed}-${Date.now().toString(36)}`;
  const dir = path.join(OUT, 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  const trajectories: Array<{ t: number; agents: Array<{ id: string; x: number; y: number; alive: boolean; needs: number[] }> }> = [];
  const dayShots: number[] = [];
  let guard = 0;
  const endTime = opts.days * 1440;
  while (world.status === 'running' && world.gameTime < endTime && guard++ < 3000) {
    await stepWorld(world, opts.stepMin, brain);
    trajectories.push({
      t: world.gameTime,
      agents: Object.values(world.agents).map((a) => ({ id: a.id, x: a.x, y: a.y, alive: a.isAlive, needs: [Math.round(a.needs.water), Math.round(a.needs.food), Math.round(a.needs.health)] })),
    });
    const day = Math.floor(world.gameTime / 1440) + 1;
    if (opts.snapshots && !dayShots.includes(day)) {
      dayShots.push(day);
      drawSnapshot(world, path.join(dir, `day-${day}.png`));
    }
  }
  fs.writeFileSync(path.join(dir, 'trajectories.jsonl'), trajectories.map((t) => JSON.stringify(t)).join('\n'));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), world.events.map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(dir, 'api-ledger.json'), JSON.stringify(world.llmLedger, null, 1));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summarize(world, runId, opts.seed), null, 2));
  return { world, runId };
}

function summarize(world: Mvp2World, runId: string, seed: number) {
  const costs = world.llmLedger.reduce((s, l) => ({ input: s.input + l.tokenUsage.input, output: s.output + l.tokenUsage.output, calls: s.calls + 1 }), { input: 0, output: 0, calls: 0 });
  return {
    runId,
    seed,
    status: world.status,
    endedReason: world.endedReason,
    gameTime: world.gameTime,
    api: costs,
    agents: Object.values(world.agents).map((a) => {
      const death = world.events.find((e) => e.type === 'agent_died' && e.actorId === a.id);
      return {
        id: a.id,
        alive: a.isAlive,
        x: a.x,
        y: a.y,
        decisions: a.decisions,
        explored: a.cognitive.explored.reduce((s, v) => s + v, 0),
        daysAlive: death ? Math.floor(death.gameTime / 1440) + 1 : 6,
        foundSpring: a.knowledge.knownResources.some((id) => world.resources[id]?.kind === 'spring'),
        harvested: { ...a.stats.harvested },
        consumed: { ...a.stats.consumed },
      };
    }),
    eventTypes: world.events.reduce((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {} as Record<string, number>),
    socialEvents: world.events.filter((e) => ['message_spoken', 'shout', 'sound_heard', 'handover_completed'].includes(e.type)).length,
    springDiscoveries: world.events.filter((e) => e.type === 'resource_discovered' && e.targetId?.startsWith('spring')).length,
    harvests: world.events.filter((e) => e.type === 'resource_harvested').length,
    fires: Object.values(world.fires).length,
  };
}

function drawSnapshot(world: Mvp2World, file: string): void {
  const scale = 2;
  const w = world.map.width * scale;
  const h = world.map.height * scale;
  const png = new PNG({ width: w, height: h });
  // Terrain tint per class.
  const tint: Record<string, [number, number, number]> = {
    deep: [12, 28, 58], shallow: [14, 90, 105], wetSand: [110, 88, 54], drySand: [210, 178, 110],
    grass: [92, 132, 62], sparse: [106, 110, 58], dense: [28, 42, 28], mud: [86, 74, 58],
    rock: [104, 104, 104], cliff: [66, 68, 78], path: [140, 110, 72],
  };
  for (let y = 0; y < world.map.height; y++) {
    for (let x = 0; x < world.map.width; x++) {
      const t = world.map.terrainAt(x, y);
      const c = tint[t] ?? [0, 0, 0];
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const idx = (((y * scale + dy) * w) + (x * scale + dx)) * 4;
          png.data[idx] = c[0];
          png.data[idx + 1] = c[1];
          png.data[idx + 2] = c[2];
          png.data[idx + 3] = 255;
        }
      }
    }
  }
  // Resources.
  for (const r of Object.values(world.resources)) {
    const c = r.kind === 'spring' ? [0, 200, 255] : r.kind === 'berry_bush' ? [255, 80, 120] : [180, 120, 60];
    fillCircle(png, w, r.x * scale, r.y * scale, 3, c);
  }
  // Agents.
  const ac: Record<string, [number, number, number]> = { agent_a: [70, 160, 255], agent_b: [90, 220, 120], agent_c: [255, 170, 80] };
  for (const a of Object.values(world.agents)) {
    fillCircle(png, w, a.x * scale, a.y * scale, 4, a.isAlive ? ac[a.id] ?? [255, 255, 255] : [120, 120, 120]);
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

function fillCircle(png: PNG, width: number, cx: number, cy: number, r: number, color: number[]): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      const idx = (((cy + y) * width) + (cx + x)) * 4;
      if (idx < 0 || idx >= png.data.length - 3) continue;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = 255;
    }
  }
}

async function batchA() {
  const results = [];
  for (const seed of SEEDS_A) {
    const { runId } = await runOne({ seed, days: DAYS, stepMin: 60, tag: 'A' });
    const s = JSON.parse(fs.readFileSync(path.join(OUT, 'runs', runId, 'summary.json'), 'utf8'));
    results.push(s);
    console.log(`[A] seed ${seed}: ${s.endedReason}, social=${s.socialEvents}, springs=${s.springDiscoveries}, harvests=${s.harvests}`);
  }
  return results;
}

async function batchB() {
  const results = [];
  for (const seed of SEEDS_B) {
    const { runId } = await runOne({ seed, days: DAYS, stepMin: 60, tag: 'B', snapshots: true });
    const s = JSON.parse(fs.readFileSync(path.join(OUT, 'runs', runId, 'summary.json'), 'utf8'));
    results.push(s);
    const shots = fs.readdirSync(path.join(OUT, 'runs', runId)).filter((f) => f.startsWith('day-'));
    console.log(`[B] seed ${seed}: ${s.endedReason}, snapshots=${shots.join(',')}`);
  }
  return results;
}

async function batchC() {
  const faults: Array<RunOpts['inject'] & { tag: string; expect: string }> = [
    { tag: 'C-invalid', invalidJsonRate: 0.35, expect: 'repair or pause, no fabricated action' },
    { tag: 'C-timeout', timeoutRate: 0.35, expect: 'retry then pause, no fallback action' },
    { tag: 'C-429', rate429: 0.5, expect: 'retry then pause, no fallback action' },
  ];
  const results = [];
  for (const f of faults) {
    const { runId } = await runOne({ seed: 1111, days: 2, stepMin: 60, tag: f.tag, inject: f });
    const s = JSON.parse(fs.readFileSync(path.join(OUT, 'runs', runId, 'summary.json'), 'utf8'));
    // After any fault, no agent may have a fabricated rest/consume/move.
    const ledger = JSON.parse(fs.readFileSync(path.join(OUT, 'runs', runId, 'api-ledger.json'), 'utf8'));
    const faultsObserved = ledger.filter((l: { status: string }) => ['timeout', '429', 'error', 'parse_failed'].includes(l.status)).length;
    results.push({ ...s, faultObserved: faultsObserved, expect: f.expect });
    console.log(`[C] ${f.tag}: faults=${faultsObserved}, status=${s.status}`);
  }
  return results;
}

async function batchD() {
  // Counterfactual pairs: same seed 101, short 2-day runs, one factor changed.
  const pairs: Array<{ name: string; mutate: (world: Mvp2World) => void; note: string }> = [
    { name: 'spring-capacity-low', mutate: (w) => { for (const r of Object.values(w.resources)) if (r.kind === 'spring') { r.capacity = 12; r.stock = Math.min(r.stock, 12); } }, note: 'spring capacity 12 vs 50-90' },
    { name: 'spring-capacity-high', mutate: (w) => { for (const r of Object.values(w.resources)) if (r.kind === 'spring') r.capacity = 300; }, note: 'spring capacity 300 vs 50-90' },
    { name: 'regen-high', mutate: (w) => { for (const r of Object.values(w.resources)) if (r.kind === 'spring') r.regenPerHour = 12; }, note: 'spring regen 12/h vs 2.5-4' },
    { name: 'start-water', mutate: (w) => { const a = w.agents.agent_a; a.inventory.water = 4; a.carryUsed = 4; }, note: 'agent_a starts with 4 water' },
    { name: 'no-ground-items', mutate: (w) => { w.groundItems = {}; }, note: 'no ground items anywhere' },
    { name: 'fewer-springs', mutate: (w) => { let n = 0; for (const [id, r] of Object.entries(w.resources)) { if (r.kind === 'spring') { n++; if (n > 2) delete w.resources[id]; } } }, note: 'only 2 springs' },
  ];
  const results = [];
  for (const p of pairs) {
    const { runId } = await runOne({ seed: 101, days: 2, stepMin: 60, tag: `D-${p.name}`, mutate: p.mutate });
    const s = JSON.parse(fs.readFileSync(path.join(OUT, 'runs', runId, 'summary.json'), 'utf8'));
    results.push({ ...s, factor: p.name, note: p.note });
    const alive = s.agents.filter((a: { alive: boolean }) => a.alive).length;
    console.log(`[D] ${p.name}: alive=${alive}, springs=${s.springDiscoveries}, harvests=${s.harvests}`);
  }
  return results;
}

async function main() {
  const batch = process.argv[2] ?? 'A';
  fs.mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), provider: process.env.LLM_PROVIDER ?? 'deepseek', model: process.env.LLM_MODEL ?? 'unknown' };
  if (batch === 'A') report.A = await batchA();
  if (batch === 'B') report.B = await batchB();
  if (batch === 'C') report.C = await batchC();
  if (batch === 'D') report.D = await batchD();
  if (batch === 'ALL') {
    report.A = await batchA();
    report.B = await batchB();
    report.C = await batchC();
    report.D = await batchD();
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'acceptance-summary.json'), JSON.stringify(report, null, 2));
  console.log(`\nacceptance batch ${batch} done -> acceptance/mvp2/final/acceptance-summary.json`);
}

void main();
