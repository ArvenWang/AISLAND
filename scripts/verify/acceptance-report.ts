// Engineering acceptance report (PRD 21.1 final step): records commit/branch
// and the pass status of every verify gate into docs/MVP2_ENGINEERING_REPORT.md.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function commitInfo(): { sha: string; branch: string } {
  try {
    return {
      sha: execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim(),
      branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim(),
    };
  } catch {
    return { sha: 'unknown', branch: 'unknown' };
  }
}

const gates: Array<{ name: string; cmd: string }> = [
  { name: 'lint', cmd: 'npm run lint' },
  { name: 'typecheck', cmd: 'npm run typecheck' },
  { name: 'unit', cmd: 'npm run test:unit' },
  { name: 'integration', cmd: 'npm run test:integration' },
  { name: 'assets:audit', cmd: 'npm run assets:audit' },
  { name: 'static-forbidden-scan', cmd: 'npx tsx scripts/verify/static-forbidden-scan.ts' },
  { name: 'map:validate-source', cmd: 'npm run map:validate-source' },
  { name: 'map:build', cmd: 'npm run map:build' },
  { name: 'map:analyze', cmd: 'npm run map:analyze' },
  { name: 'map:preview', cmd: 'npm run map:preview' },
  { name: 'spatial-replay', cmd: 'npx tsx scripts/verify/spatial-replay.ts' },
  { name: 'render-telemetry', cmd: 'npx tsx scripts/verify/render-telemetry.ts' },
  { name: 'visual-regression', cmd: 'npx tsx scripts/verify/visual-regression.ts' },
  { name: 'performance-smoke', cmd: 'npx tsx scripts/verify/performance-smoke.ts' },
];

function main() {
  const { sha, branch } = commitInfo();
  const results: Array<{ name: string; pass: boolean; detail: string }> = [];
  for (const g of gates) {
    try {
      const out = execSync(g.cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const detail = out.trim().split('\n').filter((l) => /PASS|passed|Tests:|problems|preview written/.test(l)).slice(-2).join(' | ');
      results.push({ name: g.name, pass: true, detail });
      console.log(`[ok] ${g.name}`);
    } catch (e) {
      const detail = String((e as { stderr?: string; stdout?: string }).stderr ?? e).slice(0, 300).replace(/\n/g, ' | ');
      results.push({ name: g.name, pass: false, detail });
      console.log(`[FAIL] ${g.name}`);
    }
  }
  const allPass = results.every((r) => r.pass);
  const outDir = join(root, 'docs');
  mkdirSync(outDir, { recursive: true });
  const lines = [
    '# MVP2 工程验证报告（Engineering）',
    '',
    `- commit: \`${sha}\``,
    `- branch: \`${branch}\``,
    `- 时间: ${new Date().toISOString()}`,
    `- 总结果: ${allPass ? 'PASS' : 'FAIL'}`,
    '',
    '| 门槛 | 结果 | 摘要 |',
    '| --- | --- | --- |',
    ...results.map((r) => `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.detail.replace(/\|/g, '/')} |`),
    '',
  ];
  writeFileSync(join(outDir, 'MVP2_ENGINEERING_REPORT.md'), lines.join('\n'));
  console.log(`engineering report written: docs/MVP2_ENGINEERING_REPORT.md (${allPass ? 'all gates pass' : 'some gates failed'})`);
  if (!allPass) process.exit(1);
}

main();
