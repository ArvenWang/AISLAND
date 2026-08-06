# AI Native Island Demo V0.1 - Final Acceptance Report

## 1. Build Identity
- Commit SHA: b963a1845d027aa3aa78bf0d10627a1a29647693
- Branch: main
- Upstream AI Town SHA: 7b242334bfbfef02f7718bded120d431e8f307df
- Scenario version: island-scenario-v0.3
- Prompt version: island-prompt-v0.4
- Date: 2026-08-06T00:46:33.485Z

## 2. Environment
- OS / Node / Browser: macOS / Node 22 / Chromium (Playwright)
- LLM provider and model: deepseek / deepseek-v4-flash
- Database mode: local authoritative server + JSON persistence (no Convex; documented deviation)

## 3. Requirement Traceability
| Requirement ID | Implementation | Test | Result | Evidence |
| --- | --- | --- | --- | --- |
| DEL-001 | server/index.ts + npm run dev / npm start | manual + E2E | Pass | README.md |
| DEL-002 | StartPage 创建新局/种子/连接状态 | E2E island.spec.ts | Pass | test-results/ + acceptance/visible/ |
| DEL-003 | 五日运行/暂停/恢复 | E2E + integration | Pass | tests/integration/engine.test.ts |
| DEL-004 | 全知观察 UI（动机/参数/知识/库存/关系/承诺） | E2E 断言 | Pass | src/components/panels/InspectorPanel.tsx |
| DEL-005 | 中文对话/SpeechAct/承诺影响系统状态 | integration | Pass | tests/integration/engine.test.ts |
| DEL-006 | 死亡停止+背包拾取 | integration RES-004/005 | Pass | FX-DEATH-BAG |
| DEL-007 | 结局页与导出对账 | E2E + export bundle | Pass | acceptance/visible/*/run-bundle.json |
| DEL-008 | 重开新局+导出 JSON | E2E | Pass | tests/e2e/island.spec.ts |
| WORLD-001..005 | 五日时钟/暂停恢复/单循环/加速模式/冻结终局 | unit+integration | Pass | tests/ |
| MAP-001..005 | Tiled 语义层/知识校验/移动成本/发现分享/地图结构 | unit map.test.ts | Pass | server/engine/map.ts |
| RES-001..006 | 守恒/节点/需求阈值/死亡背包/拾取/禁食尸 | unit+integration | Pass | tests/ |
| ACT-001..005 | 动作集合/注册表/单层动作/fallback/批次公平 | unit+integration | Pass | tests/ |
| SOC-001..006 | 短对话/SpeechAct/结构化状态/承诺判定/关系溯源/联盟派生 | unit+integration | Pass | tests/ |
| UI-001..008 | 开始页/主界面/洞察/认知切换/事件流/关系三角/控制/结局 | E2E | Pass | tests/e2e/island.spec.ts |
| LOG-001..004 | 事件账本/字段/导出包/密钥扫描 | unit+导出校验 | Pass | server/save/persistence.ts |
| PROFILE-001..004 | 档案覆盖/参数使用/禁止标签/同步 | unit profile.test.ts | Pass | tests/unit/profile.test.ts |
| LLM-001..004 | 统一适配/中文输出/用量记录/三模式 | unit+integration+real API | Pass | server/llm/ |
| INV-001..006 | 守恒/死亡停止/知识溯源/幂等/关系引用/重放一致 | unit+integration | Pass | tests/ |
| SAVE-001..004 | 刷新恢复/重启不重复/只读/快照启动 | integration | Pass | tests/integration/engine.test.ts |
| REL-001..004 | 25 局无卡死/恢复/无效动作告警/错误扫描 | sim + real API | 见第 5/7 节 | acceptance/ |

## 4. Automated Test Results
- build: Pass (tsc server + vite build)
- lint: Pass (0 errors, 0 warnings)
- typecheck: Pass
- unit: 42/42 Pass
- integration: 9/9 Pass
- e2e: 2/2 Pass (完整用户路径 + 无后端不崩溃)
- simulation: 12 局 mock 门槛全部达标（见 acceptance/sim-report.json 或本报告第 7 节备注）

## 5. Real API Acceptance
- Complete runs: 22
- Completion rate: 100.0%
- Meaningful social rate: 100.0%
- Cooperation rate: 100.0%
- Competition rate: 100.0%
- Strategy shift rate: 59.1%
- Outcome diversity (max share): 45.5%
- Promises: 15 total / 15 terminal
- Average / P95 / total cost: $0.0858 / $0.0936 / $1.8866
- Invalid action / repair / fallback: 见 runSummaries 与 D 批 bundle

## 6. Five Visible Runs
- V1_FX-BASE: fixture FX-BASE, screenshots 6 张, bundle=是 — 结局=two_survive_conflict 幸存=2 死亡=[脱水] 合作=6 竞争=50 承诺=2(守0/违0/不可2) 对话=15
  - [01-start-page.png](../../acceptance/visible/V1_FX-BASE/01-start-page.png)
  - [02-day1-inspector.png](../../acceptance/visible/V1_FX-BASE/02-day1-inspector.png)
  - [03-agent-knowledge-view.png](../../acceptance/visible/V1_FX-BASE/03-agent-knowledge-view.png)
  - [04-relationships.png](../../acceptance/visible/V1_FX-BASE/04-relationships.png)
  - [05-event-stream.png](../../acceptance/visible/V1_FX-BASE/05-event-stream.png)
  - [06-end-page.png](../../acceptance/visible/V1_FX-BASE/06-end-page.png)
- V2_FX-WATER-SECRET: fixture FX-WATER-SECRET, screenshots 6 张, bundle=是 — 结局=two_survive_conflict 幸存=2 死亡=[脱水] 合作=6 竞争=45 承诺=0(守0/违0/不可0) 对话=18
  - [01-start-page.png](../../acceptance/visible/V2_FX-WATER-SECRET/01-start-page.png)
  - [02-day1-inspector.png](../../acceptance/visible/V2_FX-WATER-SECRET/02-day1-inspector.png)
  - [03-agent-knowledge-view.png](../../acceptance/visible/V2_FX-WATER-SECRET/03-agent-knowledge-view.png)
  - [04-relationships.png](../../acceptance/visible/V2_FX-WATER-SECRET/04-relationships.png)
  - [05-event-stream.png](../../acceptance/visible/V2_FX-WATER-SECRET/05-event-stream.png)
  - [06-end-page.png](../../acceptance/visible/V2_FX-WATER-SECRET/06-end-page.png)
- V3_FX-DEPENDENCY: fixture FX-DEPENDENCY, screenshots 6 张, bundle=是 — 结局=two_survive_conflict 幸存=2 死亡=[饥饿] 合作=10 竞争=49 承诺=0(守0/违0/不可0) 对话=22
  - [01-start-page.png](../../acceptance/visible/V3_FX-DEPENDENCY/01-start-page.png)
  - [02-day1-inspector.png](../../acceptance/visible/V3_FX-DEPENDENCY/02-day1-inspector.png)
  - [03-agent-knowledge-view.png](../../acceptance/visible/V3_FX-DEPENDENCY/03-agent-knowledge-view.png)
  - [04-relationships.png](../../acceptance/visible/V3_FX-DEPENDENCY/04-relationships.png)
  - [05-event-stream.png](../../acceptance/visible/V3_FX-DEPENDENCY/05-event-stream.png)
  - [06-end-page.png](../../acceptance/visible/V3_FX-DEPENDENCY/06-end-page.png)
- V4_FX-CONTENTION: fixture FX-CONTENTION, screenshots 6 张, bundle=是 — 结局=two_survive_conflict 幸存=2 死亡=[脱水] 合作=10 竞争=9 承诺=1(守1/违0/不可0) 对话=11
  - [01-start-page.png](../../acceptance/visible/V4_FX-CONTENTION/01-start-page.png)
  - [02-day1-inspector.png](../../acceptance/visible/V4_FX-CONTENTION/02-day1-inspector.png)
  - [03-agent-knowledge-view.png](../../acceptance/visible/V4_FX-CONTENTION/03-agent-knowledge-view.png)
  - [04-relationships.png](../../acceptance/visible/V4_FX-CONTENTION/04-relationships.png)
  - [05-event-stream.png](../../acceptance/visible/V4_FX-CONTENTION/05-event-stream.png)
  - [06-end-page.png](../../acceptance/visible/V4_FX-CONTENTION/06-end-page.png)
- V5_FX-PROMISE-CRISIS: fixture FX-PROMISE-CRISIS, screenshots 6 张, bundle=是 — 结局=two_survive_conflict 幸存=2 死亡=[饥饿] 合作=6 竞争=68 承诺=1(守0/违1/不可0) 对话=24
  - [01-start-page.png](../../acceptance/visible/V5_FX-PROMISE-CRISIS/01-start-page.png)
  - [02-day1-inspector.png](../../acceptance/visible/V5_FX-PROMISE-CRISIS/02-day1-inspector.png)
  - [03-agent-knowledge-view.png](../../acceptance/visible/V5_FX-PROMISE-CRISIS/03-agent-knowledge-view.png)
  - [04-relationships.png](../../acceptance/visible/V5_FX-PROMISE-CRISIS/04-relationships.png)
  - [05-event-stream.png](../../acceptance/visible/V5_FX-PROMISE-CRISIS/05-event-stream.png)
  - [06-end-page.png](../../acceptance/visible/V5_FX-PROMISE-CRISIS/06-end-page.png)

## 6.1 Structured Behavioral Evidence (eventIds)
- c00-bundle.json — 合作：苏禾 给 林澈 资源 — evt_0138
- c00-bundle.json — 竞争/违约：harvest_blocked — evt_0085
- c00-bundle.json — 承诺终态：promise_impossible — evt_0289
- c00-bundle.json — 策略转变触发事件：location_shared — evt_0075
- c01-bundle.json — 合作：林澈 给 苏禾 资源 — evt_0046
- c01-bundle.json — 竞争/违约：harvest_blocked — evt_0106
- c01-bundle.json — 策略转变触发事件：location_shared — evt_0041
- c02-bundle.json — 合作：林澈 给 石磊 资源 — evt_0084
- c02-bundle.json — 竞争/违约：harvest_blocked — evt_0131
- c02-bundle.json — 策略转变触发事件：location_shared — evt_0101
- c03-bundle.json — 合作：苏禾 给 林澈 资源 — evt_0121
- c03-bundle.json — 竞争/违约：harvest_blocked — evt_0120
- c03-bundle.json — 策略转变触发事件：location_shared — evt_0106

## 6.2 Fault Recovery (D batch)
- d1_invalid_json: FX-LLM-INVALID 注入 10% 非法 JSON，完整结束（repair 正常计数）。
- d2_timeout: 首次调用注入超时，世界降级并完整结束。
- d3_429: 首次调用注入 429，世界降级并完整结束。

## 7. Behavioral Metrics
- 合作/竞争/互惠/策略转变/联盟窗口由 BehaviorAnalyzer 从事件日志自动计算（server/engine/metrics.ts）。
- 门槛对照与逐局数据见 acceptance/real-api/acceptance-report.json 与 acceptance/sim-report.json。

## 8. Correctness Audits
- Resource conservation: Pass（integration INV-001，水/食物账本差值为 0）
- Knowledge isolation: Pass（GM 拒绝未知目标；E2E 认知视图验证）
- Relationship traceability: Pass（每条 delta 带 sourceEventId）
- Event replay: 存档往返一致（SAVE 集成测试）

## 9. Defects and Fixes
- P0: 0
- P1: 0
- P2（已修复并在开发进展记录）: 节点落在不可通行格导致角色无法采集；探索半径不足导致资源不可发现；WS 跨世界广播与重连时序；Pixi Stage 卸载异常。
- P2（遗留，非阻断）: 决策节奏高于 PRD 预算（45 分钟决策间隔 + 触发去抖后仍约 250-450 次/局，含对话）；导出为单 JSON 而非 zip；旧世界驻留内存。

## 10. How to Run
```bash
npm install
cp .env.example .env   # 填入 LLM_API_KEY
npm run dev            # http://localhost:5173
npm run test:unit && npm run test:integration && npm run test:e2e
npm run acceptance:real-api -- --c 20 --d 3
npx tsx tests/acceptance/visible-runs.ts
```

## 11. Final Decision
- 待 P6 全部批次完成后由开发 Agent 依据本节数据给出 PASS/FAIL 与理由。
