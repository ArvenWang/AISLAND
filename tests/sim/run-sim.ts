// Headless accelerated simulation batch (PRD 24.1 Simulation, 13.3, 25.3).
// Usage:
//   npx tsx tests/sim/run-sim.ts --count 20 --mode mock|real [--out acceptance/sim-report.json]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { createWorld } from '../../server/engine/world';
import { SimulationEngine } from '../../server/engine/engine';
import { LlmAdapter } from '../../server/llm/adapter';
import { serializeWorld } from '../../server/save/persistence';
import type { FixtureId, WorldState } from '../../server/engine/types';

const args = process.argv.slice(2);
const count = Number(args[args.indexOf('--count') + 1] ?? 20);
const mode = (args[args.indexOf('--mode') + 1] ?? 'mock') as 'mock' | 'real';
const outPath = args[args.indexOf('--out') + 1] ?? 'acceptance/sim-report.json';
const fixtures: FixtureId[] = ['FX-BASE', 'FX-WATER-SECRET', 'FX-DEPENDENCY', 'FX-CONTENTION', 'FX-PROMISE-CRISIS', 'FX-DEATH-BAG'];

async function runOne(fixture: FixtureId, seed: number, index: number): Promise<{ world: WorldState; wallMs: number; ok: boolean }> {
  const { world } = createWorld(`sim_${index}_${fixture}`, fixture, { seed, timeScale: 3000 }, mode);
  const engine = new SimulationEngine(world, new LlmAdapter(world.scenario));
  const started = Date.now();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      engine.stop();
      resolve({ world, wallMs: Date.now() - started, ok: false });
    }, 600_000);
    engine.onEnded = (w) => {
      clearTimeout(timeout);
      resolve({ world: w, wallMs: Date.now() - started, ok: true });
    };
    engine.start();
  });
}

async function main() {
  console.log(`[sim] mode=${mode} count=${count}`);
  const results: Array<{
    index: number;
    fixture: FixtureId;
    seed: number;
    completed: boolean;
    wallMs: number;
    outcomeClass: string;
    cooperation: number;
    competition: number;
    reciprocityLoops: number;
    strategyShifts: number;
    allianceWindows: number;
    promises: { total: number; fulfilled: number; broken: number };
    conversations: number;
    wasteRate: number;
    plannerCalls: number;
    dialogueCalls: number;
    repairCalls: number;
    invalidActions: number;
    p95LatencyMs: number;
    costUsd: number;
    survivors: number;
    worldId: string;
  }> = [];

  for (let i = 0; i < count; i++) {
    const fixture = fixtures[i % fixtures.length];
    const seed = 100 + i * 37 + (fixture === 'FX-BASE' ? 1 : 0);
    const { world, wallMs, ok } = await runOne(fixture, seed, i);
    const m = world.finalStats?.metrics;
    const summary = world.llmUsage.summary;
    results.push({
      index: i,
      fixture,
      seed,
      completed: ok,
      wallMs,
      outcomeClass: m?.outcomeClass ?? 'no_metrics',
      cooperation: m?.cooperationEvents.length ?? 0,
      competition: m?.competitionEvents.length ?? 0,
      reciprocityLoops: m?.reciprocityLoops ?? 0,
      strategyShifts: m?.strategyShifts.length ?? 0,
      allianceWindows: m?.allianceWindows.length ?? 0,
      promises: {
        total: m?.promises.total ?? 0,
        fulfilled: m?.promises.fulfilled ?? 0,
        broken: m?.promises.broken ?? 0,
      },
      conversations: m?.conversationCount ?? 0,
      wasteRate: m?.wasteRate ?? 1,
      plannerCalls: summary.plannerCalls,
      dialogueCalls: summary.dialogueCalls,
      repairCalls: summary.repairCalls,
      invalidActions: m?.invalidActionCount ?? 0,
      p95LatencyMs: summary.p95LatencyMs,
      costUsd: summary.totalCostUsd,
      survivors: world.finalStats?.survivors.length ?? 0,
      worldId: world.worldId,
    });
    const status = ok ? 'OK ' : 'FAIL';
    console.log(
      `[sim] #${i} ${fixture} seed=${seed} ${status} ${(wallMs / 1000).toFixed(1)}s outcome=${results[results.length - 1].outcomeClass} coop=${results[results.length - 1].cooperation} comp=${results[results.length - 1].competition} promises=${results[results.length - 1].promises.total}`,
    );
  }

  // Aggregate thresholds (25.3).
  const completed = results.filter((r) => r.completed);
  const completionRate = results.length ? completed.length / results.length : 0;
  const socialRuns = completed.filter((r) => r.promises.total > 0 || r.conversations > 0 || r.cooperation > 0).length;
  const coopRuns = completed.filter((r) => r.cooperation > 0).length;
  const compRuns = completed.filter((r) => r.competition > 0).length;
  const shiftRuns = completed.filter((r) => r.strategyShifts > 0).length;
  const outcomeDist: Record<string, number> = {};
  for (const r of completed) outcomeDist[r.outcomeClass] = (outcomeDist[r.outcomeClass] ?? 0) + 1;
  const maxOutcome = Math.max(0, ...Object.values(outcomeDist));
  const totalPromises = completed.reduce((s, r) => s + r.promises.total, 0);
  const terminalPromises = completed.reduce((s, r) => s + r.promises.fulfilled + r.promises.broken, 0);
  const invalidRate = completed.reduce((s, r) => s + r.invalidActions, 0) / Math.max(1, completed.length);
  const avgCost = completed.reduce((s, r) => s + r.costUsd, 0) / Math.max(1, completed.length);
  const p95Cost = [...completed].sort((a, b) => a.costUsd - b.costUsd)[Math.floor(completed.length * 0.95)]?.costUsd ?? 0;
  const avgPlanner = Math.round(completed.reduce((s, r) => s + r.plannerCalls, 0) / Math.max(1, completed.length));

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    count: results.length,
    completed: completed.length,
    completionRate,
    thresholds: {
      completionRate,
      meaningfulSocialRate: socialRuns / Math.max(1, completed.length),
      cooperationRate: coopRuns / Math.max(1, completed.length),
      competitionRate: compRuns / Math.max(1, completed.length),
      strategyShiftRate: shiftRuns / Math.max(1, completed.length),
      outcomeDiversity: maxOutcome / Math.max(1, completed.length),
      promises: { total: totalPromises, terminal: terminalPromises },
      invalidActionRate: invalidRate,
    },
    costs: { avgPerRunUsd: avgCost, p95PerRunUsd: p95Cost, totalUsd: completed.reduce((s, r) => s + r.costUsd, 0) },
    calls: { avgPlannerPerRun: avgPlanner, totalPlanner: completed.reduce((s, r) => s + r.plannerCalls, 0), totalDialogue: completed.reduce((s, r) => s + r.dialogueCalls, 0), totalRepair: completed.reduce((s, r) => s + r.repairCalls, 0) },
    outcomeDistribution: outcomeDist,
    runs: results,
  };
  mkdirSync(join(process.cwd(), 'acceptance'), { recursive: true });
  const target = outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  writeFileSync(target, JSON.stringify(report, null, 2));

  console.log('\n=== SIM REPORT ===');
  console.log(`completionRate: ${(completionRate * 100).toFixed(1)}% (need >= 95%)`);
  console.log(`meaningfulSocialRate: ${((socialRuns / Math.max(1, completed.length)) * 100).toFixed(1)}% (need >= 80%)`);
  console.log(`cooperationRate: ${((coopRuns / Math.max(1, completed.length)) * 100).toFixed(1)}% (need >= 40%)`);
  console.log(`competitionRate: ${((compRuns / Math.max(1, completed.length)) * 100).toFixed(1)}% (need >= 30%)`);
  console.log(`strategyShiftRate: ${((shiftRuns / Math.max(1, completed.length)) * 100).toFixed(1)}% (need >= 20%)`);
  console.log(`maxOutcomeShare: ${((maxOutcome / Math.max(1, completed.length)) * 100).toFixed(1)}% (need < 80%)`);
  console.log(`promises: ${totalPromises} total, ${terminalPromises} terminal`);
  console.log(`invalidActionRate: ${invalidRate.toFixed(3)} (need < 0.05)`);
  console.log(`avgCost/run: $${avgCost.toFixed(4)}, p95: $${p95Cost.toFixed(4)}, total: $${report.costs.totalUsd.toFixed(4)}`);
  console.log(`report: ${outPath}`);
  void serializeWorld;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
