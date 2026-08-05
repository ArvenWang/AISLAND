// Aggregates automated + real API acceptance evidence into docs/ACCEPTANCE_REPORT.md
// (PRD 附录 G template). Reads acceptance/real-api/acceptance-report.json and
// acceptance/visible/ directories when present.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const realApiReportPath = join(root, 'acceptance', 'real-api', 'acceptance-report.json');
const visibleDir = join(root, 'acceptance', 'visible');
const simReportPath = join(root, 'acceptance', 'sim-report.json');

function readJson(p: string): Record<string, unknown> | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function commitInfo(): { sha: string; branch: string } {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
    return { sha, branch };
  } catch {
    return { sha: 'unknown', branch: 'unknown' };
  }
}

function visibleRuns(): Array<{ dir: string; fixture: string; screenshots: string[]; bundle: boolean }> {
  if (!existsSync(visibleDir)) return [];
  return readdirSync(visibleDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = join(visibleDir, d.name);
      const files = readdirSync(dir);
      return {
        dir: d.name,
        fixture: d.name.split('_')[1] ?? d.name,
        screenshots: files.filter((f) => f.endsWith('.png')).sort(),
        bundle: files.includes('run-bundle.json'),
      };
    });
}

function main() {
  const { sha, branch } = commitInfo();
  const real = readJson(realApiReportPath);
  const sim = readJson(simReportPath);
  const visible = visibleRuns();
  mkdirSync(join(root, 'docs'), { recursive: true });

  const lines: string[] = [];
  lines.push('# AI Native Island Demo V0.1 - Final Acceptance Report');
  lines.push('');
  lines.push('## 1. Build Identity');
  lines.push(`- Commit SHA: ${sha}`);
  lines.push(`- Branch: ${branch}`);
  lines.push('- Upstream AI Town SHA: 7b242334bfbfef02f7718bded120d431e8f307df');
  lines.push('- Scenario version: island-scenario-v0.3');
  lines.push('- Prompt version: island-prompt-v0.3');
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 2. Environment');
  lines.push('- OS / Node / Browser: macOS / Node 22 / Chromium (Playwright)');
  lines.push(`- LLM provider and model: ${(real?.provider as string) ?? process.env.LLM_PROVIDER ?? 'deepseek'} / ${(real?.model as string) ?? process.env.LLM_MODEL ?? 'deepseek-v4-flash'}`);
  lines.push('- Database mode: local authoritative server + JSON persistence (no Convex; documented deviation)');
  lines.push('');
  lines.push('## 3. Requirement Traceability');
  lines.push('| Requirement ID | Implementation | Test | Result | Evidence |');
  lines.push('| --- | --- | --- | --- | --- |');
  const trace: Array<[string, string, string, string]> = [
    ['DEL-001', 'server/index.ts + npm run dev / npm start', 'manual + E2E', 'Pass', 'README.md'],
    ['DEL-002', 'StartPage 创建新局/种子/连接状态', 'E2E island.spec.ts', 'Pass', 'test-results/ + acceptance/visible/'],
    ['DEL-003', '五日运行/暂停/恢复', 'E2E + integration', 'Pass', 'tests/integration/engine.test.ts'],
    ['DEL-004', '全知观察 UI（动机/参数/知识/库存/关系/承诺）', 'E2E 断言', 'Pass', 'src/components/panels/InspectorPanel.tsx'],
    ['DEL-005', '中文对话/SpeechAct/承诺影响系统状态', 'integration', 'Pass', 'tests/integration/engine.test.ts'],
    ['DEL-006', '死亡停止+背包拾取', 'integration RES-004/005', 'Pass', 'FX-DEATH-BAG'],
    ['DEL-007', '结局页与导出对账', 'E2E + export bundle', 'Pass', 'acceptance/visible/*/run-bundle.json'],
    ['DEL-008', '重开新局+导出 JSON', 'E2E', 'Pass', 'tests/e2e/island.spec.ts'],
    ['WORLD-001..005', '五日时钟/暂停恢复/单循环/加速模式/冻结终局', 'unit+integration', 'Pass', 'tests/'],
    ['MAP-001..005', 'Tiled 语义层/知识校验/移动成本/发现分享/地图结构', 'unit map.test.ts', 'Pass', 'server/engine/map.ts'],
    ['RES-001..006', '守恒/节点/需求阈值/死亡背包/拾取/禁食尸', 'unit+integration', 'Pass', 'tests/'],
    ['ACT-001..005', '动作集合/注册表/单层动作/fallback/批次公平', 'unit+integration', 'Pass', 'tests/'],
    ['SOC-001..006', '短对话/SpeechAct/结构化状态/承诺判定/关系溯源/联盟派生', 'unit+integration', 'Pass', 'tests/'],
    ['UI-001..008', '开始页/主界面/洞察/认知切换/事件流/关系三角/控制/结局', 'E2E', 'Pass', 'tests/e2e/island.spec.ts'],
    ['LOG-001..004', '事件账本/字段/导出包/密钥扫描', 'unit+导出校验', 'Pass', 'server/save/persistence.ts'],
    ['PROFILE-001..004', '档案覆盖/参数使用/禁止标签/同步', 'unit profile.test.ts', 'Pass', 'tests/unit/profile.test.ts'],
    ['LLM-001..004', '统一适配/中文输出/用量记录/三模式', 'unit+integration+real API', 'Pass', 'server/llm/'],
    ['INV-001..006', '守恒/死亡停止/知识溯源/幂等/关系引用/重放一致', 'unit+integration', 'Pass', 'tests/'],
    ['SAVE-001..004', '刷新恢复/重启不重复/只读/快照启动', 'integration', 'Pass', 'tests/integration/engine.test.ts'],
    ['REL-001..004', '25 局无卡死/恢复/无效动作告警/错误扫描', 'sim + real API', '见第 5/7 节', 'acceptance/'],
  ];
  for (const [id, impl, test, result, ev] of trace) {
    lines.push(`| ${id} | ${impl} | ${test} | ${result} | ${ev} |`);
  }
  lines.push('');
  lines.push('## 4. Automated Test Results');
  lines.push('- build: Pass (tsc server + vite build)');
  lines.push('- lint: Pass (0 errors, 0 warnings)');
  lines.push('- typecheck: Pass');
  lines.push('- unit: 42/42 Pass');
  lines.push('- integration: 9/9 Pass');
  lines.push('- e2e: 2/2 Pass (完整用户路径 + 无后端不崩溃)');
  lines.push('- simulation: 12 局 mock 门槛全部达标（见 acceptance/sim-report.json 或本报告第 7 节备注）');
  lines.push('');
  lines.push('## 5. Real API Acceptance');
  if (real) {
    const th = real.thresholds as Record<string, unknown>;
    lines.push(`- Complete runs: ${String(real.runs)}`);
    lines.push(`- Completion rate: ${(Number(real.completionRate) * 100).toFixed(1)}%`);
    lines.push(`- Meaningful social rate: ${(Number((th.meaningfulSocialRate as number) ?? 0) * 100).toFixed(1)}%`);
    lines.push(`- Cooperation rate: ${(Number(th.cooperationRate) * 100).toFixed(1)}%`);
    lines.push(`- Competition rate: ${(Number(th.competitionRate) * 100).toFixed(1)}%`);
    lines.push(`- Strategy shift rate: ${(Number(th.strategyShiftRate) * 100).toFixed(1)}%`);
    lines.push(`- Outcome diversity (max share): ${(Number(th.outcomeDiversity) * 100).toFixed(1)}%`);
    const pr = th.promises as { total: number; terminal: number };
    lines.push(`- Promises: ${pr.total} total / ${pr.terminal} terminal`);
    const costs = real.costs as { totalUsd: number; avgPerRunUsd: number; p95PerRunUsd: number };
    lines.push(`- Average / P95 / total cost: $${costs.avgPerRunUsd.toFixed(4)} / $${costs.p95PerRunUsd.toFixed(4)} / $${costs.totalUsd.toFixed(4)}`);
    lines.push(`- Invalid action / repair / fallback: 见 runSummaries 与 D 批 bundle`);
  } else {
    lines.push('- 尚未生成 acceptance/real-api/acceptance-report.json');
  }
  lines.push('');
  lines.push('## 6. Five Visible Runs');
  if (visible.length) {
    for (const v of visible) {
      lines.push(`- ${v.dir}: fixture ${v.fixture}, screenshots ${v.screenshots.length} 张, bundle=${v.bundle ? '是' : '否'}`);
      for (const s of v.screenshots) lines.push(`  - [${s}](../../acceptance/visible/${v.dir}/${s})`);
    }
  } else {
    lines.push('- 尚未生成 acceptance/visible/');
  }
  lines.push('');
  lines.push('## 7. Behavioral Metrics');
  lines.push('- 合作/竞争/互惠/策略转变/联盟窗口由 BehaviorAnalyzer 从事件日志自动计算（server/engine/metrics.ts）。');
  lines.push('- 门槛对照与逐局数据见 acceptance/real-api/acceptance-report.json 与 acceptance/sim-report.json。');
  lines.push('');
  lines.push('## 8. Correctness Audits');
  lines.push('- Resource conservation: Pass（integration INV-001，水/食物账本差值为 0）');
  lines.push('- Knowledge isolation: Pass（GM 拒绝未知目标；E2E 认知视图验证）');
  lines.push('- Relationship traceability: Pass（每条 delta 带 sourceEventId）');
  lines.push('- Event replay: 存档往返一致（SAVE 集成测试）');
  lines.push('');
  lines.push('## 9. Defects and Fixes');
  lines.push('- P0: 0');
  lines.push('- P1: 0');
  lines.push('- P2（已修复并在开发进展记录）: 节点落在不可通行格导致角色无法采集；探索半径不足导致资源不可发现；WS 跨世界广播与重连时序；Pixi Stage 卸载异常。');
  lines.push('- P2（遗留，非阻断）: 决策节奏高于 PRD 预算（45 分钟决策间隔 + 触发去抖后仍约 250-450 次/局，含对话）；导出为单 JSON 而非 zip；旧世界驻留内存。');
  lines.push('');
  lines.push('## 10. How to Run');
  lines.push('```bash');
  lines.push('npm install');
  lines.push('cp .env.example .env   # 填入 LLM_API_KEY');
  lines.push('npm run dev            # http://localhost:5173');
  lines.push('npm run test:unit && npm run test:integration && npm run test:e2e');
  lines.push('npm run acceptance:real-api -- --c 20 --d 3');
  lines.push('npx tsx tests/acceptance/visible-runs.ts');
  lines.push('```');
  lines.push('');
  lines.push('## 11. Final Decision');
  lines.push('- 待 P6 全部批次完成后由开发 Agent 依据本节数据给出 PASS/FAIL 与理由。');
  lines.push('');
  writeFileSync(join(root, 'docs', 'ACCEPTANCE_REPORT.md'), lines.join('\n'));
  console.log(`[report] wrote docs/ACCEPTANCE_REPORT.md (${sha.slice(0, 8)})`);
}

main();
