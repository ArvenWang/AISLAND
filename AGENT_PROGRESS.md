# AGENT_PROGRESS.md — AI 原生荒岛（AI Native Island）

> 本文档是本项目的统一进展事实源（按项目 AGENTS.md 要求维护）。详细阶段记录见
> `docs/DEVELOPMENT_PROGRESS.md`，最终验收报告见 `docs/ACCEPTANCE_REPORT.md`。

## 当前状态（2026-08-06 晚）

**P0-P6 全部完成（2026-08-06）：真实 API 验收全部门槛通过，最终报告已生成。**

- 仓库基线：AI Town `7b242334bfbfef02f7718bded120d431e8f307df`（2026-06-12 main），
  已 fork 并保留 MIT License；见 `NOTICE.md`。
- 架构决策：本机无 Docker / 无 Convex 账号，按 PRD 17/18 的本地可运行要求，
  **将 Convex 持久层替换为本地权威服务端**（`server/`，单进程 Node + HTTP/WS + JSON 存档），
  保留 AI Town 的 PixiJS 渲染、瓦片地图、精灵资产与异步 Agent 操作模式。
  这是对 PRD 文字（“以 AI Town 为底座”）在环境约束下的唯一可行落地方案，已在
  `docs/DEVELOPMENT_PROGRESS.md` 记录决策理由。
- LLM：DeepSeek（OpenAI 兼容），默认 `deepseek-v4-flash`，支持 mock / replay / real 三模式。
- 测试：单元 42 通过、集成 9 通过、E2E 2 通过、模拟批跑指标达标（12 局 mock）。
- 真实 API 行为调优记录（prompt v0.3 -> v0.4）：
  1) 角色系统性忽略食物（多人 0 食物消耗、椰林从未被发现）→ 增加 exploredZones 追踪、
     “尚未探索区域”显式提示、探索可远程发起（含路程时间）、生存常识规则；
  2) 闲聊过多（88 次/局）→ 目的化交谈门控（具体理由 + 6 岛上小时冷却）；
  3) DeepSeek reasoning_effort=none → 规划 P95 延迟 9.7s -> 2.0s，单局成本约 $0.08-0.12。
- 已完成：真实 API 统计批 20 局 + 故障恢复 3 局 + 可见试玩 5 局（截图/导出包齐全），
  行为门槛全部通过（详见 docs/ACCEPTANCE_REPORT.md）。

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

## 下一步（正式版候选）

1. 复审初始资源平衡（苏禾在 3/5 可见局中死亡，反映能力不平等但需要平衡确认）。
2. 评估决策节奏与 LLM 调用预算（当前 230-290 次/局，高于 PRD 建议值）。
3. 导出 zip 打包与旧世界资源回收。

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
