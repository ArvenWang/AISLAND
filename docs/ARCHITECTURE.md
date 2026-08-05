# ARCHITECTURE.md — 运行架构与模块边界

## 1. 总体架构

单进程 Node.js 权威服务端 + 浏览器客户端（React + PixiJS）。

```
┌──────────────┐  HTTP/WS   ┌─────────────────────────────┐
│  浏览器客户端  │ ◄────────► │  server/ 权威服务端           │
│ React + Pixi │            │  ├─ api/server.ts (HTTP+WS)  │
│  src/*        │            │  ├─ engine/* 模拟引擎        │
└──────────────┘            │  ├─ llm/*   LLM 适配/规划/对话│
                            │  └─ save/     JSON 存档/导出  │
                            └─────────────────────────────┘
```

世界时间、角色位置、资源库存、动作状态、关系、承诺、死亡与知识事实全部由服务端维护
（PRD 18.1 Server-authoritative）。前端只订阅展示；LLM 只能提出意图，不能直接写状态。

## 2. 数据流（PRD 18.2）

1. Survival tick（每 10 岛上分钟）推进需求/健康/资源再生/动作进度。
2. DecisionScheduler（每 30 岛上分钟 + 事件触发）收集空闲角色，生成同快照决策批次。
3. PerceptionSystem 为每名角色生成严格隔离的可见事实与已知地点。
4. LLM Planner 返回结构化 ActionIntent（索引选择）+ 动机 + fallback。
5. GameMasterValidator 执行 schema/知识/距离/库存/预约/死亡校验。
6. ActionSystem 预约资源、移动到目标并在结束时间统一结算。
7. EventLog 写入真实结果，ObserverResolver 计算可观察角色。
8. Relationship/Promise/Knowledge 系统消费事件更新派生状态。
9. 前端订阅世界快照与事件流，结束后生成结局页。

## 3. 模块边界

| 模块 | 输入 | 输出 | 禁止事项 |
| --- | --- | --- | --- |
| PlannerService | 角色结构化上下文 + 可用动作 | ActionIntent | 不得改库/自造 targetId |
| DialogueService | 双方可见上下文 | SpeechAct 序列 | 不得用文本暗改资源/知识 |
| GameMasterValidator | Intent + 权威状态 | ValidatedAction/Rejection | 不得调用 LLM 决定物理结果 |
| ActionSystem | ValidatedAction | ActionInstance + ResultEvent | 不得按模型响应时间排序 |
| PerceptionSystem | 事件/位置/视野 | 每人 Observations | 不得泄漏秘密库存/动机/未知地点 |
| RelationshipSystem | 结构化事件 | 可解释 delta | 不得仅因自由文本大幅变更 |
| BehaviorAnalyzer | 完整 EventLog | 事后标签与指标 | 不得写回角色初始类型 |

## 4. 决策公平（PRD 4.3 / 8.4）

- 决策批次使用同一 `snapshotVersion` 与 `requestedGameTime`。
- 批次等待期间世界逻辑冻结（PRD 明确允许“暂停世界逻辑，继续播放已有动画”），
  全部意图以同一游戏时间提交，杜绝“返回快的模型抢先”。
- 节点结算按动作结束时间（游戏时间）顺序执行，先到先得；同刻平局由 seeded RNG 决定。

## 5. 确定性

- 全部非 LLM 随机来自 seeded RNG（mulberry32，seed 来自 ScenarioConfig）。
- 同 seed + mock 模式可完整重放同一事件序列；`rngState` 随存档持久化。
- 存档：每 15 秒 + 控制操作时写入 `server/data/worlds/<worldId>.json`；
  重启后从存档重建（SAVE-002），已结算动作不会重复执行（operationId 幂等）。

## 6. LLM 协议（PRD 21）

- 统一 OpenAI 兼容适配器：DeepSeek `https://api.deepseek.com/v1`。
- 三模式：`mock`（确定性，离线测试）、`replay`（录制重放）、`real`（真实 API）。
- JSON 输出：`response_format: json_object`；严格解析 + 1 次 repair + fallback。
- 超时/429/网络错误：指数退避语义（记录状态），决策批次降级为安全 rest。
- 密钥只在服务端 `.env`；日志与导出只含 provider/model/脱敏指纹。

## 7. 与上游的关系

- 上游：a16z-infra/ai-town `7b242334bfbfef02f7718bded120d431e8f307df`（MIT）。
- 保留：PixiJS 渲染模式、瓦片地图格式与精灵资产、异步操作思想、网格寻路。
- 替换：Convex（云/自托管依赖）→ 本地权威服务端；Claude/Clerk 认证 → 单用户本地。
- 设计参考：Google DeepMind Concordia（Apache-2.0）的 Entity/Component/GameMaster/
  ActionSpec/Simultaneous Resolution 模式，仅思想迁移，无代码复制。
