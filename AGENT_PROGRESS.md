# AGENT_PROGRESS.md — AI 原生荒岛（AI Native Island）

> 本文档是本项目的统一进展事实源（按项目 AGENTS.md 要求维护）。详细阶段记录见
> `docs/DEVELOPMENT_PROGRESS.md`，最终验收报告见 `docs/ACCEPTANCE_REPORT.md`。

## 当前状态（2026-08-06 晚）

**P0-P6 全部完成（2026-08-06）：真实 API 验收全部门槛通过，最终报告已生成。**

### 最近更新（2026-08-06，本地部署验证）

- 角色纹理串色修复 + 植被资源补充（2026-08-06）：
  - **串色根因**：`sprites.ts` 的 `characterTextureUrl` 写死返回旧纹理
    `32x32folk.png`，新角色 spritesheet（island_a/b/c）帧坐标按
    `island-characters.png` 设计，实际却从旧图集切帧 → 移动时显示
    其他角色的发色/衣服。修复：按 sheet 名映射正确纹理 URL。
  - 地形过渡升级为**距离场渐变混合**：每格到各地形的 BFS 距离场 +
    反距离平方权重，跨 2-3 格连续渐变（草→沙→浅水→深水自然过渡，
    无格子台阶/硬切），替代原 8 向权重合成。
  - 新增 9 种植被 props（草丛/白花/蕨类/黄花/灌木/粉花/干草/蘑菇/苔石），
    加入地图散落装饰池。
  - 验证：typecheck、42 单测通过；240x 实测三角色纹理均来自
    island-characters.png、地图过渡连续、零报错。

- 地形边缘重构（第三轮，2026-08-06）：预生成"8 向固定过渡 tile"的方向语义
  反了（N/S、E/W 互换）且无法覆盖多方向邻接，导致海岸线断裂错位。
  改为**运行时按 8 邻域位掩码动态合成**过渡纹理（方向权重函数取各方向最大
  权重，任意邻接组合连续）；tileset 精简为 6 行纯中心变体（256x192），
  并用亮度归一化消除同地形变体间的明暗跳变（水纹平铺不再出"色带"）。
  改动：`server/engine/map.ts`（EDGE_ROWS 只保留 lower 关系）、
  `src/components/pixi/IslandStage.tsx`（Image 加载 tileset 像素 +
  离屏 canvas 逐像素合成 + 纹理缓存）。
  验证：typecheck、42 单测、生产构建通过；240x 实测地图无缝、海岸线连续、
  走格子移动正常、零报错。

- 走格子移动 + 地形边缘过渡（2026-08-06 第二轮资产重构）：
  - 移动改为**逐格步进**：前端按 server 的 A* 路径（passable 网格，可走/不可走
    由 `map.passable/moveCost` 决定）展开为格子队列，每格 300ms 匀速 + 100ms
    格间停顿，方向正交（不斜穿），240x 极速下同样逐格走。路径缺失时平滑趋近
    服务端权威位置。改动：`src/components/pixi/AgentSprite.tsx`。
  - tileset 按仓库正确流程重做：imagegen 生成 **full-bleed 无 gutter** 地形图
    （此前生成图带洋红间隔，切格后边缘错色/透明），`extract_terrain_tiles.py`
    以 `--edge-policy seamless` 切格（6 地形 × 3 变体）。
  - **地形边缘过渡**：新增 5 组 8 向过渡 tile（grass-sand / sand-shallow /
    shallow-deep / rock-grass / dirt-grass），用同源纹理程序化合成（方向语义
    精确、纹理无缝），渲染层做 8 邻域边缘检测自动选择过渡 tile。
    tileset 布局 8 列 × 11 行（`public/assets/island-tileset.png`，
    `server/engine/map.ts` 的 T 索引 + EDGE_ROWS，`IslandStage.tsx` 边缘检测）。
  - 教训：1) imagegen 生成 tileset 必须要求 full-bleed 无 gutter，且实际行数
    需像素级验证（本次生成图只有 6 条色带，按 7 行切会整体错位）；
    2) 列数变化时所有 tile 索引必须按 row*cols+col 重新计算。
  - 验证：typecheck 通过、单元测试 42 项通过、240x 采样确认逐格移动
    （wp 索引逐格递增 + 格间停顿）、海岸线/草沙/岩石边缘渲染正确、零报错。

- 游戏资产重构（agent-sprite-forge 工作流，2026-08-06）：
  - 角色：3 个全新荒岛风格四方向行走精灵（林澈=救援队服 / 石磊=工装硬汉 /
    苏禾=植物研究员），`public/assets/island-characters.png` + `data/spritesheets/island-{a,b,c}.ts`，
    覆盖原 AI Town 通用村民（f1/f3/f4）；旧角色数据保留兼容。
  - 地图：全新荒岛 tileset（草/沙/浅水/深水/土路/岩石/岩壁，10x7 格，
    `public/assets/island-tileset.png`）+ 独立 props（椰树/泉水/潮池/木箱/篝火/
    篮子/草丛/木头/水瓶/贝壳/石头，`public/assets/island/*.png`）。
    地图数据新增 `decorProps` 字段（`server/engine/types.ts`、`map.ts` v0.2），
    旧存档无该字段时前端回退渲染旧 objectTiles，兼容无迁移成本。
  - 切格要点：imagegen 生成图含洋红 gutter，切格时必须**裁掉 gutter 再拉伸**
    （tile 内容零间距），不能用"邻域填充"补边缘——会把相邻 tile 的颜色填进
    边缘形成网格线。tileset 必须无透明像素（透明会透出 Pixi 背景色）。
  - Vite `/assets` 代理已移除：dev 模式 assets 由 Vite 直服务 public/，
    否则新增资产必须重新 build 进 dist 才能访问。
  - 角色移动不再瞬移：`AgentSprite` 根据服务端 move 动作的
    `path/startedAt/endsAt + gameTime` 前端插值位置（240x 极速下验证连续移动），
    不再直接跳变坐标。
  - 事件 ID 修复：`emitEvent` 以世界事件数组长度生成 ID（原模块级计数器在
    dev 热重启后归零，导致与已加载存档事件 ID 重复、日志重复显示）。
  - 验证：typecheck 通过、单元测试 42 项通过、真实浏览器 240x 全流程零报错、
    地图无缝无网格线、角色连续移动；生产构建 + 8788 端口资产验证通过。

- 修复开发模式地图空白：`React.StrictMode` 双跑 effect 时，`PersistentStage`
  卸载会把 Pixi app 销毁并复用同一 canvas，导致 WebGL 上下文失效
  （`checkMaxIfStatementsInShader` 异常）→ 错误边界 `PixiBoundary` 永久卸载地图。
  修复：卸载改为延迟销毁（宏任务），双跑重挂载时复用已有 app；`PixiBoundary`
  失败时显示「重试」入口而非永久空白。涉及 `src/components/pixi/PersistentStage.tsx`
  与 `src/components/GameView.tsx`。
- 验证：typecheck 通过、单元测试 42 项通过、真实浏览器（系统 Chrome，headed）
  完整一局无 console/page 错误、地图/角色/事件流正常；生产构建 `npm run build`
  通过并在 8788 端口验证可访问。
- 环境注意：本仓库 `node_modules` 经企业微信传输后丢失执行位并带 macOS
  quarantine 标记，首次 `npm run dev` 需 `chmod +x` 相关 bin/esbuild 并
  `xattr -dr com.apple.quarantine node_modules`（本次已处理）。

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

- P2（已修复 2026-08-06）：`PersistentStage` 在 React StrictMode 下的销毁/重建
  WebGL 上下文问题（见「最近更新」）；`PixiBoundary` 已提供重试入口。
- P2：世界关闭后旧世界会持续驻留内存（供恢复查看）；重启服务器会重新加载全部存档。
- P2：浏览器端导出包为单 JSON 文件（manifest/scenario/profiles/events/final-state/metrics/llm-usage 内嵌），
  符合 LOG-003 字段要求但未打包为 zip。
- 规划调用数高于 PRD 预算（约 400-500/局 vs 建议 40-90）：原因是 3 角色 × 30 岛上分钟决策
  节奏 × 动作完成后的空闲期；已通过触发去抖（10 分钟冷却）与单批并行优化，成本影响有限
  （见 ACCEPTANCE_REPORT 成本节）。

## 当前独占文件（其他 Agent 请勿同时修改）

- `server/engine/*`、`server/llm/*`、`src/components/*`、`tests/*`、`docs/*`
