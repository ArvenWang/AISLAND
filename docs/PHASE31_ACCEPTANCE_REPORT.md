# Phase 3.1 Small Island / Deep Agents 验收报告

> 状态（2026-08-09）：**Phase 3.1 完成**。P0–P8、6×7 日 REAL-01…REAL-08、
> 3 对反事实 CF-01…CF-04 与最终 `npm run verify:phase31` 均通过。

- 需求事实源：`/Users/nefish/Downloads/AISLAND_Phase3.1_Small_Island_Deep_Agents_PRD_V0.7.docx`
- 开发分支：`codex/phase3.1-small-island-deep-agents`
- 基线：`c89434698fd2a921368e69a10cfd476f63dc475c`
- P0–P7 commits：`3787f50`、`74c838f`、`ac705a7`、`4519322`、`02c2596`、
  `388b52b`、`3a26108`、`ba13fa2`
- P8 commit：`a7c35f9`（`phase31-p8 complete real-api acceptance`）

## 1. 当前结论

Phase 3.1 的地图、资产、世界内动作、真实对话呈现、长期认知/社会机制、地图优先 UI
和自动验收均已实现并有结构化证据。最终批次使用 6 个固定 seed、完整 7 日世界、真实
`deepseek/deepseek-v4-flash`，共 1998 次调用；没有 mock/replay/fallback 或特殊 seed 剧本。

REAL-01…REAL-08 全部通过：6/6 局首日零死亡，6/6 局 Day 3 至少两人存活，6/6 局
出现多轮会话、因果链和双边事件；117 条消息的可见重复为 0。1 局跑满 Day 7 且 1 人
存活，5 局因可解释的脱水/饥饿/耗竭提前结束。反事实 3/3 对也出现计划、行动或结果分叉。

## 2. Definition of Done 对照

| 项目 | 当前结果 | 结构化证据 |
| --- | --- | --- |
| 80×52 手工设计小岛 | 通过；陆地 52.74%，唯一泉水，三出生点相距 3–7 格且互相可见 | `acceptance/phase31/map/topology-qc.json` |
| 主机身唯一、资产复用 | 通过；AST-001…AST-007 全通过，零违规 | `acceptance/phase31/assets/asset-reuse-audit.json` |
| 地图内 P0 动作与 commit | 通过；状态仅在 65% commit 窗口变化 | unit telemetry + `phase31-action-presentation.test.ts` |
| 地图显示真实对话文本 | 通过；36/36 message 有 speech presentation，正文重叠率 0 | `acceptance/phase31/presentation/live-speech-evidence.json` |
| 多轮 Conversation / 双向 Offer / 关系一次性 | 通过；6/6 局有多轮，Offer 只有接收后才转移，关系不重复累计 | unit evidence + REAL bundles |
| Persistent Plan / Memory / Reflection / Profile mechanics | 通过；计划跨多动作推进，记忆可被后续 LLM 引用 | unit evidence + REAL causal chains |
| 地图优先 UI | 通过；日志与 Peek 默认关闭，Debug 隔离，桌面/移动无横向溢出 | `acceptance/phase31/ui/browser-verification.json` |
| 7 日周期与首日缓冲 | 通过；6/6 首日零死亡，6/6 Day 3 有 3 人存活 | REAL bundles |
| 3 对反事实短局 | **通过（CF-01…CF-04）** | `acceptance/phase31/counterfactual-real/counterfactual-report.json` |
| 6×7 日真实 API | **通过（REAL-01…REAL-08）** | `acceptance/phase31/real-api/batch-report.json` |
| `npm run verify:phase31` | **通过**；含 REAL/CF audit 与 17 个结构化证据门 | `acceptance/phase31/core-evidence-audit.json` |

## 3. 6×7 日真实 API 验收

| 局 / seed | 结局 | Day 3 存活 | 多轮会话 / 最大轮数 | 双边事件 | 消息 / 重复 | 因果链 | LLM 调用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 / 31415 | all_dead · 7050 min | 3 | 2 / 6 | 4 | 10 / 0 | 20 | 316 |
| 02 / 27182 | all_dead · 6225 min | 3 | 2 / 6 | 12 | 13 / 0 | 20 | 280 |
| 03 / 16180 | seven_days · 1 人存活 | 3 | 5 / 6 | 19 | 28 / 0 | 20 | 443 |
| 04 / 14142 | all_dead · 5120 min | 3 | 2 / 6 | 10 | 11 / 0 | 20 | 238 |
| 05 / 17320 | all_dead · 9140 min | 3 | 6 / 6 | 14 | 26 / 0 | 20 | 354 |
| 06 / 22360 | all_dead · 8075 min | 3 | 7 / 6 | 22 | 29 / 0 | 20 | 367 |

- REAL-01：6/6 real bundles；provider/model 与 ledger 一致；行动 provenance 重新计算均为 1.0。
- REAL-02：6/6 首日非 trauma 死亡为 0。
- REAL-03：6/6 在 Day 3 至少有 2 人存活（实际均为 3 人）。
- REAL-04：6/6 至少存在 1 个 2+ turn ConversationSession（门槛 4/6）。
- REAL-05：6/6 至少存在 1 条完整因果链（每局导出 20 条，字段交叉引用有效）。
- REAL-06：0/117 条可见消息重复，整体 0.00%（门槛 <10%）。
- REAL-07：6/6 至少存在一次主动接近、Request、JointIntent、Offer/拒绝/递交之一（门槛 3/6）。
- REAL-08：6/6 完整到 Day 7 或全员死亡；所有死亡均为 dehydration/starvation/exhaustion，
  `unexplainedDeaths=0`。

汇总：1998 次真实 LLM 调用；输入 4,061,859 tokens、输出 566,371 tokens、缓存 61,440
tokens；provider/model 均为 `deepseek/deepseek-v4-flash`。这些 token 和墙钟数用于审计，
不是产品性能承诺。

## 4. 反事实验收（真实 API）

实验保持同一对内的地图版本、角色 profiles 和 seed 完全一致，控制状态 SHA-256 指纹一致；
唯一改变变量为海滩散落水 `4→2`。每局观察 36 岛时，temperature 为 0；没有注入
“合作场景”“竞争场景”或新人格。

| seed | 4 水：消息 / 多轮 / 双边 | 2 水：消息 / 多轮 / 双边 | 4 水→2 水的资源行为 | 行为分叉 |
| --- | --- | --- | --- | --- |
| 73001 | 6 / 1 / 4 | 0 / 0 / 0 | 拾水 4→2；泉水采集 4→4；饮水 5→5 | 是 |
| 73002 | 11 / 2 / 5 | 13 / 2 / 9 | 拾水 4→2；泉水采集 10→10；饮水 11→1 | 是 |
| 73003 | 6 / 2 / 5 | 4 / 0 / 4 | 拾水 4→2；泉水采集 18→11；饮水 11→11 | 是 |

- CF-01：3/3 匹配对、6/6 real bundles、行动 provenance 全为 1.0。
- CF-02：每对控制指纹一致，唯一变量为 `loose_opening_water_units`。
- CF-03：3/3 对的计划、行动或结果发生变化（门槛 ≥2/3）。
- CF-04：6 局均沿用 `agent_a/agent_b/agent_c` 正式 profiles，无场景人格注入。

这组结果只证明“资源条件会改变真实模型的计划/行动/结果”，不用于证明某一种结局更好。

## 5. P8 真实长跑发现并修复的问题

| 发现 | 真实证据 | 修复 | 防回归 |
| --- | --- | --- | --- |
| 角色睡眠后永久退出决策 | Day 1 后 LLM 调用冻结，最终全员脱水 | 睡满 4 岛时进入可见 `wake` 身体动作 | `phase31-evolution.test.ts` |
| `talk` 可远距离提交后同 tick 关闭 | 消息 observers 不含目标，会话立即因分离结束 | directed talk 限 4 格；远处先 approach | `mvp2-conversation.test.ts` |
| 陌生人无可执行引用 | 模型三次返回 `unknown_survivor`，均被判 unknown agent | 稳定匿名 `person_*` ref；pending reply ref；泛称兼容 | `mvp2-planner.test.ts` |
| 真实模型 action 命名漂移 | `move/harvest_water/pickup` 等被误判 unsupported | 语义等价 alias 归一到权威动作 | `mvp2-planner.test.ts` |
| 发起者等待回应时重复开场、双方原样复述 | 两局可见重复率分别 38.5% / 27.3% | Conversation turn guard + 发送前近重复去重；不生成替代台词 | `mvp2-conversation.test.ts` |
| 明确问句/同行同意被模型泛化标成 `utterance` | 文本有 Request/JointIntent，但 runtime 未结构化 | 只对已说出口的明确措辞做保守 speech-act adjudication；Request 180 分钟过期 | `phase31-evolution.test.ts` |
| 可见他人不是可记忆世界事件，社交涌现不足 4/6 | 多个 seed 全程 0 talk，接口本身无失败 | 首次进入 4 格生成一次 `encounter_started`；不说话、不改关系、不交换知识，分开重逢才重发 | `phase31-evolution.test.ts` |

失败证据保存在 `acceptance/phase31/real-api/diagnostics/`，没有覆盖或冒充最终正式 bundle。

## 6. 工程验证

- 最新完整 unit：19 suites / 129 tests，通过。
- integration：1 suite / 9 个五日长时测试，通过（约 169 秒）。
- `npm run typecheck`：通过。
- ESLint（本轮文件）、`git diff --check`、`static-forbidden-scan`：通过。
- P6 浏览器：1440×900 与 390×844，无水平溢出，console error 0。
- 最终 `npm run verify:phase31`：通过；包含 lint（0 errors / 12 个既有 warnings）、
  地图、资产复用、typecheck、19 suites / 129 unit tests、1 suite / 9 integration tests、
  static forbidden scan、REAL/CF audit、17 个结构化证据门和生产构建。Vite 仍有
  主 bundle 大于 500kB 和 Browserslist 数据提示，属于发布性能维护项，不影响本 PRD
  的行为真实性验收。

## 7. 非阻塞发布维护项

1. Vite 主 JS bundle 为 857.13kB（gzip 262.59kB），高于 500kB 提示线；商业发布前建议
   单独进行路由/渲染依赖拆包，不属于本 PRD 的行为真实性阻塞项。
2. Browserslist 数据过期、`postcss.config.js` 缺少显式 module type，以及 12 个历史
   ESLint warning 应在依赖维护任务中处理；本次均为 warning、无 error。
