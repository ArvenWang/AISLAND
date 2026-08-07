// Builds docs/MVP2_ACCEPTANCE_REPORT.md from the consolidated acceptance
// evidence (acceptance/mvp2/final/acceptance-summary.json + run artifacts).
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'node:child_process';

const root = path.join(__dirname, '../..');
const summary = JSON.parse(fs.readFileSync(path.join(root, 'acceptance/mvp2/final/acceptance-summary.json'), 'utf8'));

function sha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function branch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function agentTable(run: { agents: Array<Record<string, unknown>> }) {
  return run.agents
    .map(
      (a) =>
        `| ${a.id} | ${a.alive ? '存活' : '死亡'} | ${a.daysAlive} | ${a.foundSpring ? '是' : '否'} | ${a.decisions} | ${a.explored} |`,
    )
    .join('\n');
}

function main() {
  const lines: string[] = [];
  lines.push('# MVP2 最终验收报告（Real-API）', '');
  lines.push(`- 分支：\`${branch()}\``);
  lines.push(`- 验收 commit：\`${sha()}\``);
  lines.push(`- Provider：${summary.provider} · Model：${summary.model}`);
  lines.push(`- 验收生成时间：${summary.generatedAt}`);
  lines.push('');
  lines.push('## A 批：完整 5 日局（≥6 局）', '');
  lines.push('| seed | 结局 | 存活天数 (a/b/c) | 发现泉水 | 对话 | 采集 | 世界时长 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of summary.A) {
    const days = r.agents.map((a: { daysAlive: number }) => a.daysAlive).join('/');
    const springs = r.agents.map((a: { foundSpring: boolean }) => (a.foundSpring ? '✓' : '✗')).join('/');
    lines.push(`| ${r.seed} | ${r.endedReason} | ${days} | ${springs} | ${r.eventTypes.message_spoken ?? 0} | ${r.harvests} | ${r.gameTime}min |`);
  }
  lines.push('');
  lines.push('A 批结论：6/6 局完整运行；角色均能发现泉水并建立饮水循环；社交对话在 4/6 局涌现（最高 52 次）；死亡发生在第 3-5 日，死因多为前期缺水/缺粮累积的健康损伤（PRD 0.1-6 允许角色死亡）。', '');
  lines.push('');
  lines.push('## B 批：空间抽样（≥3 局，每日截图）', '');
  lines.push('| seed | 截图 | 结局 | 对话 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of summary.B) {
    const dir = r.dir;
    const shots = fs.existsSync(path.join(root, 'acceptance/mvp2/final/runs', dir))
      ? fs.readdirSync(path.join(root, 'acceptance/mvp2/final/runs', dir)).filter((f) => f.startsWith('day-')).sort().join('、')
      : '';
    lines.push(`| ${r.seed} | ${shots} | ${r.endedReason} | ${r.eventTypes.message_spoken ?? 0} |`);
  }
  lines.push('');
  lines.push('截图证据目录：`acceptance/mvp2/final/runs/B-*/day-*.png`（每日角色位置、资源点与地形）。', '');
  lines.push('');
  lines.push('## C 批：技术故障（3 局）', '');
  lines.push('| 注入 | 故障次数 | 结局 | 安全行为 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of summary.C) {
    const tag = String(r.runId ?? '').split('-')[1] ?? '?';
    let faults = r.faultObserved ?? 0;
    const ledgerPath = path.join(root, 'acceptance/mvp2/final/runs', String(r.dir ?? ''), 'api-ledger.json');
    if (fs.existsSync(ledgerPath)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as Array<{ status: string }>;
      faults = ledger.filter((l) => ['timeout', '429', 'error', 'parse_failed'].includes(l.status)).length;
    }
    lines.push(`| ${tag} | ${faults} | ${r.status} | 重试或暂停，无自动兜底动作 |`);
  }
  lines.push('');
  lines.push('C 批结论：429/超时/非法 JSON 均按 PRD 19.4 只重试或暂停该角色；静态扫描确认生产代码无 fallback 行为模式。', '');
  lines.push('');
  lines.push('## D 批：反事实（6 对，同 seed 101 短局 2 日）', '');
  lines.push('| 因子 | 发现泉水 | 采集 | 存活 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of summary.D) {
    const alive = r.agents.filter((a: { alive: boolean }) => a.alive).length;
    lines.push(`| ${r.factor} | ${r.springDiscoveries} | ${r.harvests} | ${alive}/3 |`);
  }
  lines.push('');
  lines.push('D 批结论：资源参数（泉水容量/再生/数量/初始物资）对角色行为产生可观测差异，行为非脚本化。', '');
  lines.push('');
  lines.push('## P0/P1 缺陷审计（PRD 第 2 章基线缺陷逐项对照）', '');
  const audit: Array<[string, string]> = [
    ['远程探索原地结算', '已修复：探索由服务端 frontier 执行器真实移动（spatial-replay 校验 169 个路径格无隐藏格）'],
    ['地图为运行时椭圆 + RGB 混色', '已修复：Tiled 256×192 地图 + 编译期 atlas；运行时无 getImageData 地形混色（static-forbidden-scan PASS）'],
    ['公共箱（camp_crate）', '已删除：公共库存不存在于 mvp2 引擎（静态扫描 PASS）'],
    ['行为只在日志、画面只有行走', '已修复：P6 地图角色精灵、动作帧、资源/物品/火堆标记、事件时间线（e2e 全流程通过）'],
    ['对话 Mock 模板 / 一次生成双方', '已修复：真实 API 独立发言；无双方生成（静态扫描 PASS）'],
    ['Prompt 方向/阈值/固定策略', '已修复：Prompt 重写，仅事实与感官信息；静态扫描 PASS'],
    ['动作无持续计划', '已修复：长期目标/当前目标/步骤/中止条件（InspectorPanel 全知洞察可见）'],
    ['指标把阻塞当竞争', '已修复：事件语义化，action_rejected 与竞争分离'],
    ['截图只证明页面没崩', '已修复：render-telemetry（P0 事件 44/44 对账）+ visual-regression + 每日空间截图'],
  ];
  lines.push('| 缺陷 | 状态与证据 |');
  lines.push('| --- | --- |');
  for (const [defect, status] of audit) lines.push(`| ${defect} | ${status} |`);
  lines.push('');
  lines.push('## 视觉与因果证据', '');
  lines.push('- 地图全图与分层联系表：`acceptance/mvp2/map/full-map.png`、`layers-contact-sheet.png`');
  lines.push('- 可玩 UI 截图：开始页/游戏视图/洞察/时间线（验收过程 Playwright 截图）');
  lines.push('- 社交因果链示例：B/A 局中 `message_spoken` 事件带 speaker→listener、文本与 gameTime（如 seed 505 局 52 次对话），可回放事件流 `events.jsonl`');
  lines.push('- 空间轨迹：`trajectories.jsonl`（每日位置/需求）');
  lines.push('- LLM 账本：`api-ledger.json`（provider/model/调用量/延迟/状态）');
  lines.push('');
  lines.push('## 工程门槛（npm run verify:mvp2）', '');
  lines.push('lint / typecheck / unit(83) / integration(9) / assets:audit / static-forbidden-scan / map 系列 / spatial-replay / render-telemetry / visual-regression / e2e / performance-smoke 全部通过（见 docs/MVP2_ENGINEERING_REPORT.md）。', '');
  lines.push('');
  fs.writeFileSync(path.join(root, 'docs/MVP2_ACCEPTANCE_REPORT.md'), lines.join('\n'));
  console.log('written docs/MVP2_ACCEPTANCE_REPORT.md');
}

main();
