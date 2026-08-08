import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '../..');
const failures: string[] = [];
const passed: string[] = [];

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

function gate(id: string, condition: boolean, detail: string): void {
  if (condition) passed.push(id);
  else failures.push(`${id}: ${detail}`);
}

const map = readJson<{
  passed: boolean;
  objects: { trees: number; spawn: number; stableSpring: number; hiddenSpots: number; bottlenecks: number; routeLoops: number; viewpoints: number };
}>('acceptance/phase31/map/topology-qc.json');
gate('MAP-EVIDENCE', map.passed && map.objects.spawn === 3 && map.objects.stableSpring === 1 && map.objects.trees === 72 && map.objects.hiddenSpots >= 1 && map.objects.bottlenecks >= 2 && map.objects.routeLoops >= 1 && map.objects.viewpoints >= 1, 'map topology evidence does not match Phase 3.1 gates');

const asset = readJson<{ passed: boolean; gates: string[]; violations: unknown[]; manifestVersion: string }>('acceptance/phase31/assets/asset-reuse-audit.json');
gate('ASSET-EVIDENCE', asset.passed && asset.manifestVersion === 'phase31-props-v1' && asset.gates.length === 7 && asset.violations.length === 0, 'asset reuse audit is missing, stale, or has violations');

const presentation = readJson<{
  runtime: { mode: string; provider: string; llmCalls: number; ledgerStatuses: string[]; browserConsoleErrors: number };
  conversationEvidence: { conversationCount: number; maxTurns: number; sixTurnSessions: number; eventToPresentationCoverage: number };
  bubbleEvidence: { simultaneousCount: number; maxBodyOverlapRatio: number; minimumCompletedDurationMsObserved: number; durationGateMs: number };
  ui: { logDrawerOpen: boolean; inspectorOpen: boolean };
}>('acceptance/phase31/presentation/live-speech-evidence.json');
gate('REAL-PRESENTATION', presentation.runtime.mode === 'real' && presentation.runtime.provider !== 'mock' && presentation.runtime.llmCalls > 0 && presentation.runtime.ledgerStatuses.every((status) => status === 'ok') && presentation.runtime.browserConsoleErrors === 0, 'presentation evidence is not from a clean real-API run');
gate('CONVERSATION-PRESENTATION', presentation.conversationEvidence.conversationCount > 0 && presentation.conversationEvidence.maxTurns >= 2 && presentation.conversationEvidence.maxTurns <= 6 && presentation.conversationEvidence.sixTurnSessions > 0 && presentation.conversationEvidence.eventToPresentationCoverage === 1, 'conversation sessions or presentation coverage fail');
gate('BUBBLE-PRESENTATION', presentation.bubbleEvidence.simultaneousCount >= 2 && presentation.bubbleEvidence.maxBodyOverlapRatio === 0 && presentation.bubbleEvidence.minimumCompletedDurationMsObserved >= presentation.bubbleEvidence.durationGateMs, 'speech bubbles are unreadable, overlapping, or too short');
gate('DEFAULT-UI-PRESENTATION', !presentation.ui.logDrawerOpen && !presentation.ui.inspectorOpen, 'log drawer or inspector opened by default');

const ui = readJson<{
  map: { width: number; height: number; designVersion: string };
  desktop: { headerHeightPx: number; defaultRecordDrawerOpen: boolean; defaultAgentPeekOpen: boolean; boundedCamera: { blankBottomPx: number } };
  mobile: { documentScrollWidthPx: number; viewport: [number, number]; headerHeightPx: number; horizontalOverflow: boolean };
  browserConsole: { errors: number };
  screenshots: string[];
}>('acceptance/phase31/ui/browser-verification.json');
gate('MAP-FIRST-UI', ui.map.width === 80 && ui.map.height === 52 && ui.map.designVersion === 'small-island-deep-agents-v1' && ui.desktop.headerHeightPx <= 44 && !ui.desktop.defaultRecordDrawerOpen && !ui.desktop.defaultAgentPeekOpen && ui.desktop.boundedCamera.blankBottomPx === 0, 'desktop map-first UI metrics fail');
gate('RESPONSIVE-UI', ui.mobile.documentScrollWidthPx === ui.mobile.viewport[0] && ui.mobile.headerHeightPx <= 44 && !ui.mobile.horizontalOverflow && ui.browserConsole.errors === 0, 'mobile UI overflow, header, or console gate fails');
for (const screenshot of ui.screenshots) {
  const file = path.join(root, 'acceptance/phase31/ui', screenshot);
  gate(`UI-SCREENSHOT-${screenshot}`, fs.existsSync(file) && fs.statSync(file).size > 100_000, `missing or suspiciously small screenshot ${screenshot}`);
}

const realBatch = readJson<{
  schema: string;
  completedBundles: number;
  passed: boolean;
  gates: Record<string, { passed: boolean; detail: string }>;
}>('acceptance/phase31/real-api/batch-report.json');
gate('REAL-API-BATCH', realBatch.schema === 'aisland.phase31.real_api_batch_report.v1'
  && realBatch.completedBundles === 6
  && realBatch.passed
  && Object.keys(realBatch.gates).length === 8
  && Object.values(realBatch.gates).every((entry) => entry.passed), '6x7-day REAL-01..REAL-08 report is missing or failed');

const counterfactual = readJson<{
  schema: string;
  passed: boolean;
  gates: Record<string, { passed: boolean; detail: string }>;
  pairComparisons: unknown[];
}>('acceptance/phase31/counterfactual-real/counterfactual-report.json');
gate('REAL-COUNTERFACTUAL', counterfactual.schema === 'aisland.phase31.counterfactual_report.v1'
  && counterfactual.passed
  && counterfactual.pairComparisons.length === 3
  && Object.keys(counterfactual.gates).length === 4
  && Object.values(counterfactual.gates).every((entry) => entry.passed), '3-pair real counterfactual report is missing or failed');

const planner = fs.readFileSync(path.join(root, 'server/mvp2/planner.ts'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'server/mvp2/engine.ts'), 'utf8');
const api = fs.readFileSync(path.join(root, 'server/mvp2/api.ts'), 'utf8');
const commitAction = engine.slice(engine.indexOf('function commitAction'), engine.indexOf('// Synchronous world step'));
gate('STATIC-NO-DIRECTOR', !['不要再重复', '改做别的事', '先开口打个招呼', '最自然的做法', '交流是获取信息'].some((phrase) => planner.includes(phrase)), 'planner contains behavior-directing language');
gate('BILATERAL-OFFER', commitAction.includes("emitEvent(world, 'offer_created'") && commitAction.includes("case 'accept_handover'") && commitAction.includes("case 'refuse_handover'") && commitAction.indexOf("emitEvent(world, 'offer_created'") < commitAction.indexOf("case 'accept_handover'"), 'offer is not a distinct pending state before accept/refuse');
gate('REAL-ONLY-API', api.includes("mode: 'real'") && api.includes('if (!process.env.LLM_API_KEY)') && api.includes("this.json(res, { error: '真实 LLM API 尚未配置，无法开始游戏。' }, 503)"), 'production API does not enforce real-only mode');

const result = {
  schema: 'aisland.phase31.core_evidence_audit.v1',
  passed: failures.length === 0,
  gates: passed,
  failures,
};
const output = path.join(root, 'acceptance/phase31/core-evidence-audit.json');
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
if (failures.length) {
  console.error('phase31-evidence-audit FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`phase31-evidence-audit PASS (${passed.length} gates)`);
