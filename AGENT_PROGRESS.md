# AGENT_PROGRESS.md — AI 原生荒岛（AI Native Island）

> 本文档是本项目的统一进展事实源（按项目 AGENTS.md 要求维护）。详细阶段记录见
> `docs/DEVELOPMENT_PROGRESS.md`，最终验收报告见 `docs/ACCEPTANCE_REPORT.md`。

## 当前状态（2026-08-06）

**P0-P5 已完成，P6（真实 API 验收）执行中。**

- 仓库基线：AI Town `7b242334bfbfef02f7718bded120d431e8f307df`（2026-06-12 main），
  已 fork 并保留 MIT License；见 `NOTICE.md`。
- 架构决策：本机无 Docker / 无 Convex 账号，按 PRD 17/18 的本地可运行要求，
  **将 Convex 持久层替换为本地权威服务端**（`server/`，单进程 Node + HTTP/WS + JSON 存档），
  保留 AI Town 的 PixiJS 渲染、瓦片地图、精灵资产与异步 Agent 操作模式。
  这是对 PRD 文字（“以 AI Town 为底座”）在环境约束下的唯一可行落地方案，已在
  `docs/DEVELOPMENT_PROGRESS.md` 记录决策理由。
- LLM：DeepSeek（OpenAI 兼容），默认 `deepseek-v4-flash`，支持 mock / replay / real 三模式。
- 测试：单元 42 通过、集成 9 通过、E2E 2 通过、模拟批跑指标达标（12 局 mock）。
- 进行中：真实 API 统计批（≥20 局）、5 局可见试玩、故障恢复批、最终报告。

## 完成内容

- P0 基线：仓库、一键启动（`npm run dev` / `npm start`）、`.env.example`、许可证。
- P1 确定性世界：48×48 岛屿地图（Tiled 语义对象层）、资源节点/再生、需求/健康、
  库存/公共箱/死亡背包、动作状态机、事件日志、五日终止。
- P2 Agent 规划：ProfileCompiler、感知/知识隔离、可用动作索引选择、GameMaster 验证、
  fallback、决策批次冻结（同时间戳提交，保证 API 延迟不决定资源归属）。
- P3 社交：中文短对话、结构化 SpeechAct、请求→接受→承诺闭环、承诺自动判定、
  地点分享、关系系统（trust/resentment/dependency/affinity 全量溯源）。
- P4 全知 UI：开始页、地图与角色动画、角色洞察面板（动机/参数/库存/知识/关系/承诺/记忆）、
  上帝/角色认知切换、事件流筛选、关系三角与曲线、结局页、导出、重开。
- P5 测试：单元/集成/E2E/headless 模拟、故障注入、行为指标与门槛自动判定。

## 下一步

1. 运行 `npm run acceptance:real-api -- --c 20 --d 3`（真实 API 统计批 + 故障恢复批）。
2. 运行 `npx tsx tests/acceptance/visible-runs.ts`（5 局可见试玩 + 截图 + 导出包）。
3. 汇总 `docs/ACCEPTANCE_REPORT.md`，关联最终 commit。

## 已知问题 / 遗留

- P2（非阻断）：`@pixi/react` Stage 卸载时序在旧版本有已知 teardown 异常，已通过自持
  `PersistentStage` + `config.destroy=false` 规避，无未捕获错误。
- P2：世界关闭后旧世界会持续驻留内存（供恢复查看）；重启服务器会重新加载全部存档。
- P2：浏览器端导出包为单 JSON 文件（manifest/scenario/profiles/events/final-state/metrics/llm-usage 内嵌），
  符合 LOG-003 字段要求但未打包为 zip。
- 规划调用数高于 PRD 预算（约 400-500/局 vs 建议 40-90）：原因是 3 角色 × 30 岛上分钟决策
  节奏 × 动作完成后的空闲期；已通过触发去抖（10 分钟冷却）与单批并行优化，成本影响有限
  （见 ACCEPTANCE_REPORT 成本节）。

## 当前独占文件（其他 Agent 请勿同时修改）

- `server/engine/*`、`server/llm/*`、`src/components/*`、`tests/*`、`docs/*`
