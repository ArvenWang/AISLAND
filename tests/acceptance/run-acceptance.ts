// Real API acceptance batches (PRD 26.2): C statistical runs + D fault recovery.
// Visible runs (A/B) are driven by tests/acceptance/visible-runs.ts (browser).
//
// Usage:
//   npx tsx tests/acceptance/run-acceptance.ts --c 20 --d 3

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { createWorld } from '../../server/engine/world';
import { SimulationEngine } from '../../server/engine/engine';
import { LlmAdapter } from '../../server/llm/adapter';
import { buildExportBundle } from '../../server/save/persistence';
import type { FixtureId, WorldState } from '../../server/engine/types';

const args = process.argv.slice(2);
const cCount = Number(args[args.indexOf('--c') + 1] ?? 20);
const dCount = Number(args[args.indexOf('--d') + 1] ?? 3);
const outDir = join(process.cwd(), 'acceptance', 'real-api');
mkdirSync(outDir, { recursive: true });

async function runOne(fixture: FixtureId, seed: number, tag: string, extra: Partial<Record<string, unknown>> = {}): Promise<WorldState> {
  const { world } = createWorld(`acc_${tag}`, fixture, { seed, timeScale: 3000, ...extra }, 'real');
  const engine = new SimulationEngine(world, new LlmAdapter(world.scenario));
  const started = Date.now();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      engine.stop();
      resolve();
    }, 1_200_000);
    engine.onEnded = () => {
      clearTimeout(timeout);
      resolve();
    };
    engine.start();
  });
  world.finalStats?.metrics;
  const wallS = ((Date.now() - started) / 1000).toFixed(1);
  const status = world.status === 'ended' ? 'OK ' : 'FAIL';
  const m = world.finalStats?.metrics;
  const sum = world.llmUsage.summary;
  console.log(`[acc] ${tag} ${fixture} seed=${seed} ${status} ${wallS}s outcome=${m?.outcomeClass ?? '?'} coop=${m?.cooperationEvents.length ?? 0} comp=${m?.competitionEvents.length ?? 0} promises=${m?.promises.total ?? 0} planner=${sum.plannerCalls} cost=$${sum.totalCostUsd.toFixed(4)}`);
  // Save the export bundle for evidence.
  writeFileSync(join(outDir, `${tag}-bundle.json`), JSON.stringify(buildExportBundle(world), null, 2));
  return world;
}

async function main() {
  if (!process.env.LLM_API_KEY) {
    console.error('[acc] LLM_API_KEY is not set. Real API acceptance requires the key.');
    process.exit(2);
  }
  const cFixtures: FixtureId[] = ['FX-BASE', 'FX-WATER-SECRET', 'FX-DEPENDENCY', 'FX-CONTENTION', 'FX-PROMISE-CRISIS', 'FX-DEATH-BAG'];
  const cResults: WorldState[] = [];

  console.log(`[acc] C batch: ${cCount} statistical runs with real API`);
  for (let i = 0; i < cCount; i++) {
    const fixture = cFixtures[i % cFixtures.length];
    const seed = 1000 + i * 53;
    const world = await runOne(fixture, seed, `c${String(i).padStart(2, '0')}`);
    cResults.push(world);
  }

  console.log(`[acc] D batch: ${dCount} fault recovery runs`);
  // D1: injected invalid JSON (fixture already sets 10%).
  await runOne('FX-LLM-INVALID', 7007, 'd1_invalid_json');
  // D2: manual timeout injection via adapter switch.
  {
    const { world } = createWorld('acc_d2_timeout', 'FX-BASE', { seed: 8008, timeScale: 3000 }, 'real');
    const adapter = new LlmAdapter(world.scenario);
    adapter.failNextWithTimeout = true;
    const engine = new SimulationEngine(world, adapter);
    const started = Date.now();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        engine.stop();
        resolve();
      }, 1_200_000);
      engine.onEnded = () => {
        clearTimeout(timeout);
        resolve();
      };
      engine.start();
    });
    console.log(`[acc] d2_timeout ${world.status === 'ended' ? 'OK ' : 'FAIL'} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    writeFileSync(join(outDir, 'd2_timeout-bundle.json'), JSON.stringify(buildExportBundle(world), null, 2));
    cResults.push(world);
  }
  // D3: 429 injection.
  {
    const { world } = createWorld('acc_d3_429', 'FX-BASE', { seed: 9009, timeScale: 3000 }, 'real');
    const adapter = new LlmAdapter(world.scenario);
    adapter.failNextWith429 = true;
    const engine = new SimulationEngine(world, adapter);
    const started = Date.now();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        engine.stop();
        resolve();
      }, 1_200_000);
      engine.onEnded = () => {
        clearTimeout(timeout);
        resolve();
      };
      engine.start();
    });
    console.log(`[acc] d3_429 ${world.status === 'ended' ? 'OK ' : 'FAIL'} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    writeFileSync(join(outDir, 'd3_429-bundle.json'), JSON.stringify(buildExportBundle(world), null, 2));
    cResults.push(world);
  }

  // Aggregate C metrics.
  const completed = cResults.filter((w) => w.status === 'ended');
  const metrics = completed.map((w) => w.finalStats!.metrics);
  const coopRuns = metrics.filter((m) => m.cooperationEvents.length > 0).length;
  const compRuns = metrics.filter((m) => m.competitionEvents.length > 0).length;
  const shiftRuns = metrics.filter((m) => m.strategyShifts.length > 0).length;
  const socialRuns = metrics.filter((m) => m.promises.total > 0 || m.conversationCount > 0 || m.cooperationEvents.length > 0).length;
  const outcomeDist: Record<string, number> = {};
  for (const m of metrics) outcomeDist[m.outcomeClass] = (outcomeDist[m.outcomeClass] ?? 0) + 1;
  const maxOutcome = Math.max(0, ...Object.values(outcomeDist));
  const promisesTotal = metrics.reduce((s, m) => s + m.promises.total, 0);
  const promisesTerminal = metrics.reduce((s, m) => s + m.promises.fulfilled + m.promises.broken + m.promises.cancelled + m.promises.impossible, 0);
  const totalCost = completed.reduce((s, w) => s + w.llmUsage.summary.totalCostUsd, 0);
  const avgCost = totalCost / Math.max(1, completed.length);
  const p95Cost = [...completed].sort((a, b) => a.llmUsage.summary.totalCostUsd - b.llmUsage.summary.totalCostUsd)[Math.floor(completed.length * 0.95)]?.llmUsage.summary.totalCostUsd ?? 0;
  const report = {
    generatedAt: new Date().toISOString(),
    provider: process.env.LLM_PROVIDER ?? 'deepseek',
    model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
    runs: completed.length,
    completionRate: completed.length / cResults.length,
    thresholds: {
      meaningfulSocialRate: socialRuns / Math.max(1, completed.length),
      cooperationRate: coopRuns / Math.max(1, completed.length),
      competitionRate: compRuns / Math.max(1, completed.length),
      strategyShiftRate: shiftRuns / Math.max(1, completed.length),
      outcomeDiversity: maxOutcome / Math.max(1, completed.length),
      promises: { total: promisesTotal, terminal: promisesTerminal },
    },
    costs: { totalUsd: totalCost, avgPerRunUsd: avgCost, p95PerRunUsd: p95Cost },
    outcomeDistribution: outcomeDist,
    runSummaries: completed.map((w) => ({
      worldId: w.worldId,
      fixture: w.scenario.fixture,
      seed: w.scenario.seed,
      outcomeClass: w.finalStats!.metrics.outcomeClass,
      cooperation: w.finalStats!.metrics.cooperationEvents.length,
      competition: w.finalStats!.metrics.competitionEvents.length,
      promises: w.finalStats!.metrics.promises,
      strategyShifts: w.finalStats!.metrics.strategyShifts.length,
      plannerCalls: w.llmUsage.summary.plannerCalls,
      dialogueCalls: w.llmUsage.summary.dialogueCalls,
      repairCalls: w.llmUsage.summary.repairCalls,
      costUsd: w.llmUsage.summary.totalCostUsd,
    })),
  };
  writeFileSync(join(outDir, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== REAL API ACCEPTANCE SUMMARY ===');
  console.log(`completionRate: ${(report.completionRate * 100).toFixed(1)}%`);
  console.log(`cooperationRate: ${(report.thresholds.cooperationRate * 100).toFixed(1)}%`);
  console.log(`competitionRate: ${(report.thresholds.competitionRate * 100).toFixed(1)}%`);
  console.log(`strategyShiftRate: ${(report.thresholds.strategyShiftRate * 100).toFixed(1)}%`);
  console.log(`promises: ${promisesTotal} total / ${promisesTerminal} terminal`);
  console.log(`total cost: $${totalCost.toFixed(4)} (avg $${avgCost.toFixed(4)}/run, p95 $${p95Cost.toFixed(4)})`);
  console.log(`report: ${join(outDir, 'acceptance-report.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
