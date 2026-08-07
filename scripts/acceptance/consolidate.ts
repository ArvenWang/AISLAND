// Rebuild acceptance/mvp2/final/acceptance-summary.json from every run dir
// (A/B/C/D), grouped by batch tag, without rerunning the LLM.
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(__dirname, '../../acceptance/mvp2/final');
const runsDir = path.join(OUT, 'runs');

function main() {
  const report: Record<string, unknown[]> = { A: [], B: [], C: [], D: [] };
  for (const d of fs.readdirSync(runsDir)) {
    const p = path.join(runsDir, d, 'summary.json');
    if (!fs.existsSync(p)) continue;
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    const runId = String(s.runId ?? '');
    const tag = runId.startsWith('A-') ? 'A' : runId.startsWith('B-') ? 'B' : runId.startsWith('C-') ? 'C' : runId.startsWith('D-') ? 'D' : null;
    if (!tag) continue;
    report[tag].push({ ...s, dir: d });
  }
  // Keep the latest run per seed (previous attempts from earlier commits may
  // still be present); B keeps the 3 latest, C/D all.
  const byTime = (arr: Array<{ dir: string }>) => arr.sort((a, b) => (a.dir > b.dir ? 1 : -1));
  const latestPerSeed = new Map<number, (typeof report.A)[number]>();
  for (const r of byTime(report.A)) latestPerSeed.set(Number(r.seed), r);
  report.A = [...latestPerSeed.values()];
  report.B = byTime(report.B).slice(-3);
  const latestPerC = new Map<string, (typeof report.C)[number]>();
  for (const r of byTime(report.C)) {
    const key = String(r.runId ?? '').split('-')[1] ?? '?';
    latestPerC.set(key, r);
  }
  report.C = [...latestPerC.values()];
  const latestPerD = new Map<string, (typeof report.D)[number]>();
  for (const r of byTime(report.D)) {
    const parts = String(r.runId ?? '').split('-');
    // runId format: D-<factor...>-<seed>-<ts> -> drop D, seed and timestamp.
    const factor = parts.length >= 4 ? parts.slice(1, -2).join('-') : '?';
    latestPerD.set(factor, { ...r, factor });
  }
  report.D = [...latestPerD.values()];
  const final = {
    generatedAt: new Date().toISOString(),
    provider: process.env.LLM_PROVIDER ?? 'deepseek',
    model: process.env.LLM_MODEL ?? 'unknown',
    A: report.A,
    B: report.B,
    C: report.C,
    D: report.D,
  };
  fs.writeFileSync(path.join(OUT, 'acceptance-summary.json'), JSON.stringify(final, null, 2));
  console.log(`consolidated: A=${final.A.length}, B=${final.B.length}, C=${final.C.length}, D=${final.D.length}`);
}

main();
