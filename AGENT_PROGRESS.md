# AGENT_PROGRESS.md — AI 原生荒岛（AI Native Island）

> 本文档是本项目的统一进展事实源（按项目 AGENTS.md 要求维护）。详细阶段记录见
> `docs/DEVELOPMENT_PROGRESS.md`，最终验收报告见 `docs/ACCEPTANCE_REPORT.md`。

---

## MVP2 第二阶段（进行中，2026-08-07 起）

> 第二阶段基线 = `AISLAND_MVP2_Iteration_Development_PRD_V0.5.docx`（已收入仓库根目录，
> 文本版见 `docs/PRD_MVP2_V0.5.txt`）。开发分支：`agent/mvp2-spatial-survival`，
> 基线 commit：`698617afc422c555b3472f35f10ce3e047d04895`。
> 本阶段开发期间，旧版（V0.3 实验控制台）代码将被系统性重构；main 分支保留为可运行对照。

### 当前状态（P0-P8 全部完成；真实 API 验收通过，最终报告已生成并推送）

> 最新 commit：`b101ff0`（docs: finalize acceptance report on final commit），
> 已推送 `origin/agent/mvp2-spatial-survival`。验收报告：
> `docs/MVP2_ACCEPTANCE_REPORT.md`；工程报告：`docs/MVP2_ENGINEERING_REPORT.md`。

### 视角比例调整（2026-08-07，动森式角色比例）

- 相机分层缩放：上帝视角默认 0.5x（约 90 格宽视野）；跟随角色自动平滑
  放大到 2.0x（角色约屏幕高 11%，动森 1/9~1/10 参考值）；手动范围
  0.2x~4x；取消跟随平滑回到全岛俯视。
- 角色体态：精灵 44×44 → 40×52（宽 1.25 格 / 高 1.6 格，动森体态），
  脚底加半透明椭圆阴影。
- 标签自适应：远视角只显示选中/行动中角色名字与资源库存；≥1x 近景
  显示全部角色与资源标签。
- HUD 新增缩放百分比指示（右下角）。
- 验证：Playwright 实测 50% → 200% → 50% 平滑切换、无 JS 错误、e2e 通过。

### 角色移动动画修复（2026-08-07，用户反馈"角色原地不动、只有地图在动"）

- 根因：`advanceMovement` 从不更新 move 动作的 `progress`（恒为 0），前端
  行走帧永远停在第一帧——角色看起来完全静止。
- 修复：服务端移动时按 waypoint 进度更新 `action.progress`；前端改为
  时间驱动的走路动画（PIXI.Ticker ~6fps 切换行走帧 1-3），移动中的角色
  持续播放走路循环；跟随镜头在角色位置变化时用 650ms 缓动平滑过渡
  （不再瞬移跳变）。
- 验证：Playwright 实测移动中角色连续帧 diff 61-131（帧在切换），
  e2e 通过；dev server 已热更新，可刷新页面查看。

### 走路动画闪烁与移动观感修复（2026-08-07，用户反馈"疯狂闪烁、每秒一格"）

- 闪烁根因：走路动画 ticker 每 PIXI 帧（60fps）切换一次行走帧，帧循环
  20 次/秒 → 肉眼呈疯狂闪烁。修复：帧推进限速到每 5 ticker 帧
  （~12fps 走帧，3 帧循环 = 每秒 4 个完整步态）；行走帧纹理预缓存，
  不再每帧 new Texture。
- 移动观感：角色位置本按游戏步长跳格（1 现实秒 = 5 游戏分钟，沙滩约
  1.4 格/秒，符合 timeScale 1x 设定）；按 PRD 18.1 增加前端插值渲染，
  角色连续平滑走到服务端权威位置，不再跳格。
- 验证：纹理帧采样显示 12fps 步态节奏（不再 60fps 闪烁）；e2e 通过。

### 本轮进展（2026-08-07 生存闭环修复，真实 API 验证）

### P6/P7/P8 完成（2026-08-07）

- P6 可玩 UI（commit 前序）：mvp2 引擎接入 API（HTTP+WS 生命周期、
  VisualActionState、导出）；开始页单一开始按钮；地图主导 GameView、
  紧凑 HUD、角色卡、全知洞察、可折叠时间线、上帝/角色视角、跟随镜头、
  Debug 隔离；MapScene 角色精灵（行走帧/名字/资源/物品/火堆标记）。
- P7 `npm run verify:mvp2` 全链：lint/typecheck/unit(83)/integration(9)/
  assets:audit/static-forbidden-scan/map 系列/spatial-replay/render-telemetry/
  visual-regression/e2e/performance-smoke/工程报告，全部通过。
- P8 真实验收（deepseek-v4-flash，最终 commit 数据）：
  - A 批 6 局 5 日：6/6 完整运行；三角色均发现泉水（6/6 局）；社交对话
    4/6 局涌现（最高 52 次）；角色活至第 3-5 日（PRD 0.1-6 允许死亡）。
  - B 批 3 局：每日空间截图（day-1..5.png）。
  - C 批 3 局故障注入（429/超时/非法 JSON）：重试或暂停，无兜底动作。
  - D 批 6 对反事实：资源参数对行为有可观测差异。
  - 最终报告：docs/MVP2_ACCEPTANCE_REPORT.md；工程报告：
    docs/MVP2_ENGINEERING_REPORT.md。
- 行为修复（验收中暴露）：talk 目标中文名/“另一名幸存者”解析；物品列表
  标注距离；too_far/no_path 反馈给具体建议；重复失败 ≥3 次强提示；
  探索前瞻 9→15 格（视野边缘）；出生点聚拢促进社交；食物本能链；
  死亡事件无条件触发；PRD 卡住检测（同目标失败 10 次暂停世界并提示）。

- 泉水环境声：每 ~2 岛时广播一次"流水声"，声学传播（PRD 9.2）给方向线索；
  修复声音方向**算反 bug**（听者听到的方向是声源的反方向，导致角色
  离泉越走越远）——propagateSound 改为 source−listener，新增单元测试。
- 探索效率：探索半径不再随迷失置信度塌缩（原低置信度只有 2 格 → 原地
  打转）；无方向探索随机 8 向；no_path 时缩圈重试。
- 决策节奏：动作/移动完成立即再决策（原非紧急冷却 150 分钟导致 5 天仅
  ~30 次决策）；紧急 20 / 正常 45 分钟冷却。
- 寻水行为链：prompt 高亮已知淡水泉与 harvest 指引；口渴且携带水时本能
  consume（原角色带水渴死）；严重脱水且知道泉时，用探索执行器朝泉推进
  （避免 move no_path 卡死），泉边直接 harvest_water。
- 南岸新增第 4 个泉（spring_south，出生点附近），南岸角色无需横穿全岛。
- 真实 API 验证（deepseek-v4-flash）：seed 101 从 3 角色 5 天内全渴死且
  资源发现仅 1 次 → seed 202 中 2/3 角色找到泉、采水并喝水（harvest 5 次、
  consumed 13 次），存活至第 6 天；死亡主因转为前期缺水累积的健康损伤
  （生存机制合理行为）。
- 遗留（已在本轮后续修复并验收）：部分角色探索推进慢、社交为 0、P6-P8 未完成
  ——详见下方 "P6/P7/P8 完成" 段。

### 开工计划（PRD 附录 D 要求）

1. 基线缺陷复述（与 PRD 第 2 章审计一致）：
   - 探索绕过空间：`explore` 折算旅行时间原地等待，可远程结算发现。
   - 地图为运行时椭圆 + RGB 距离场混色，无 Tiled/Wang 源文件。
   - 出生在岛中央；公共箱（camp_crate）人为定义公共所有权。
   - 行为主要发生在日志；画面只有行走。
   - 对话 Mock 模板硬编码；真实模式一次调用生成双方发言。
   - Prompt 含方向提示、数值阈值命令与固定策略（违反 12.3）。
   - 动作无持续计划；每次单动作选择。
   - 指标把 harvest_blocked/action_interrupted 当竞争。
   - 截图验收只证明页面没崩，无空间/视觉对账。
2. P0-P8 实施顺序（PRD 第 20 章）：
   - P0 基线冻结：分支 + 基线证据（本文件与 docs/mvp2-baseline/）。
   - P1 地图与渲染：Tiled 源文件 + Wang Set、256×192 地图、tilemap 渲染、
     `scripts/map/*` 编译/校验/分析/预览、`server/engine/map/*` 运行时数据。
   - P2 空间认知：FOV/迷雾（服务端）、认知地图、局部导航、迷路模型、
     `server/engine/perception/*`、`src/components/pixi/map/FogOverlay.tsx`。
   - P3 物品与生存：地面物品、残骸搜索、手递手、火堆、睡眠、心理状态；
     删除公共箱。
   - P4 Agent 计划：生产仅 real 模式、长期目标/计划/中止条件、无行为兜底；
     planner Prompt 重写（禁方向/阈值）。
   - P5 对话与社会：独立发言、呼喊与声学传播、Claim/传闻、知识隔离。
   - P6 UI 与视觉动作：地图主导 UI、VisualActionState 驱动动画、全知洞察、
     Debug 隔离；开始页单一开始按钮。
   - P7 自动测试：`npm run verify:mvp2`（lint→typecheck→unit→integration→
     assets:audit→static-forbidden-scan→map:validate-source→map:build→map:analyze
     →spatial-replay→render-telemetry→visual-regression→e2e→performance-smoke→
     acceptance-report:engineering）。
   - P8 真实验收：A≥6 局、B≥3 局空间抽样、C 3 局故障、D≥6 对反事实；
     自动截图 + render telemetry 对账 + 因果链；P0/P1=0；MVP2_ACCEPTANCE_REPORT。
3. 模块处置：
   - 重写：`server/engine/map.ts`、`src/components/pixi/IslandStage.tsx`、
     `AgentSprite.tsx`、`server/engine/systems.ts`、`server/llm/planner.ts`、
     `server/llm/dialogue.ts`、`server/engine/metrics.ts`、`server/engine/world.ts`、
     `server/engine/scenario.ts`、`src/components/StartPage.tsx`、
     `src/components/GameView.tsx`、`src/components/panels/*`、
     `tests/acceptance/*`。
   - 拆分：`server/llm/adapter.ts` → 生产仅 real；mock/replay 移入
     `tests/support/`。
   - 删除：公共箱/camp_crate、store/take 公共库存、远程 explore、
     Mock/Replay/Fixture 产品入口、旧 48×48 椭圆地图与 RGB 混色。
   - 保留：PixiJS 渲染栈底座、服务端权威世界循环、LLM 抽象层（重构后）、
     资源守恒/存档/事件基础（改造后）。
4. 资产与证据位置：
   - 地图源文件：`assets/source/mvp2/`（original/、normalized-32px/、tiled/）。
   - 运行时地图：`public/generated/maps/aisland-mvp2/`。
   - 许可：`assets/source/mvp2/licenses/*`、`NOTICE-ASSETS.md`。
   - 地图证据：`acceptance/mvp2/map/*`。
   - 局证据：`acceptance/mvp2/runs/<run-id>/*`、`acceptance/mvp2/bundles/`、
     `acceptance/mvp2/causal-chains/`、`acceptance/mvp2/performance/`。
   - 基线：`docs/mvp2-baseline/`。
5. 真实 API 验收预算与批次（P8）：
   - provider=deepseek，model=deepseek-v4-flash（.env 已配置，key 在本机）。
   - A 批 ≥6 局完整游戏（正常新游戏入口、不同 seed、可 4x）。
   - B 批 ≥3 局空间抽样（第 1/2/3/5 日自动截图+轨迹+状态）。
   - C 批 3 局技术故障（timeout/429/非法结构，只验技术）。
   - D 批 ≥6 对反事实（同 seed/状态只改一个参数，真实 API）。
   - 单局规划调用目标 4-10 次/角色/岛上日；总预算按 token 计费控制，
     超出 PRD 预算 30% 时先优化再继续。

### 已完成

- 游戏内道具替换为真实/生成像素素材（commit 进行中）：
  - 树木：Calciumtrice trees_23（CC-BY 4.0，6 棵真实大树，原生 96×112）。
  - 箱子/岩石：Zoria 宝箱/岩块（CC-BY 4.0，16px ×2）。
  - 物品/残骸/篝火/泉水/浆果/木柴：AI 生成 16-bit 像素风（品红底 +
    imagegen skill 色键抠图转透明）。
  - `scripts/map/real-props.ts` 装配 props.png + meta（tileSizes/cellSize），
    MapScene 按真实尺寸渲染树冠/树干分层与道具；浏览器零报错。

- 美术方向修正（用户要求：真实游戏资源、像素风、必须带边缘模块）：
  - 弃用程序化像素画与"油画生成 + 后期量化"方案；边缘不再程序切条带。
  - 地形中心块：11 类由 AI 直接生成 16-bit 像素风 tileset sheet
    （`assets/source/mvp2/original/generated-terrain/*.png`，8×8 网格，
    每格 32px 像素画 4 倍放大）。
  - 地形边缘模块：9 对过渡全部**重新生成**（旧 sheet 经自动校验确认
    "无边缘模块/方向错乱"不合格：如 wetSand-drySand 整张无 tileset 结构、
    grass-mud 边缘缺失、多张 E 侧条带被画到左侧）。新 sheet 均为
    1024×1024 8×8 网格（`transitions/<A>-<B>.png`：行 0-3 = A 主体 +
    B 条带 N/S/W/E；行 4-7 = B 主体 + A 条带 N/S/W/E）。
  - 新增边缘模块校验门 `scripts/map/validate-transitions.ts`（8 方向检测
    条带朝向，9/9 PASS），已接入 `npm run map:all`；生成器未画出右侧条带
    时（E），以 W 条带水平镜像补齐（tileset 行业标准翻转，像素级一致），
    已写入 NOTICE-ASSETS.md。
  - 中心块多变体：每类从 8×8 sheet 自动挑选纹理最丰富、边缘色一致的最多
    6 个变体（原先只取第一格，纹理单调）；地图按种子混用消除大面重复。
  - 校验门更新：textureRichness（组合块 ≥300、平均熵 ≥2.0bit）+ noFlatPlanes
    + wangCornerConsistency + travelTime + detour，全部 PASS；当前指标
    组合块 4179、平均熵 5.08 bits（重做前 1569 组合块 / 4.69 bits）。
  - 真实素材入库：Zoria（CC-BY 4.0）、Whispers of Avalon（CC-BY 3.0）、
    Island Tileset（OGA-BY 3.0）原图 + 许可文件。
  - 资产审计修复：`assets:audit` 许可映射（5 个第三方目录 ↔ licenses/ 文件、
    generated-* 为 AI 自产声明）、effects 归入 runtime atlas 登记；
    assets:audit PASS。
  - 守恒账本补全：资源再生（regen）现写入 conservationLedger（此前再生
    凭空增加总量导致守恒测试失败）；unit 82/82 + integration 9/9 全绿。

- P3 物品与生存（MVP2 引擎，256×192 地图）：
  - `server/mvp2/`：types（地面物品/火堆/资源/残骸/事件/LLM 账本）、items
    （拾取/放下/手递手/偷拿/残骸搜索/合并/守恒账本）、fire（材料校验、
    燃料燃烧、weak/embers 状态、加柴升级）、survival（需求衰减/消耗/睡眠/
    心理状态）、engine（动作状态机 + Game Master 距离/知识/容量校验、
    移动按 moveCost 推进、FOV/认知/定向每步刷新、死亡掉落、五日结束）。
  - 世界初始化从 SemanticObjects 生成物品/残骸/资源；删除公共箱与远程
    explore（本引擎不再存在该动作）。
  - 开发期驱动 `drivers.ts`（显式标注 dev-only，P4 由真实 Planner 替换）。
  - FOV 修正：射线法 LOS（阴影投射轴心格 bug 已弃用）。
  - 测试：守恒快照不变量（held+ground+资源+残骸+火堆燃料+消耗+燃烧）、
    距离/知识/容量拒绝、火堆生命周期、睡眠恢复、死亡停止、引擎步进
    （移动合法、物品流转、五日结束）。unit 69/69 + integration 9/9。

- P2 空间认知（LOS/迷雾/认知地图/局部导航/迷路）：
  - `server/engine/perception/fov.ts`：递归阴影投射（8 象限）、昼夜/火光半径、
    地形+树木+岩石视线遮挡（compile 已把树/岩写入 visionOpacity）。
  - `cognitiveMap.ts`：explored/visible、rememberedTerrain（置信度衰减）、
    landmarks 去重、routeMemories 熟悉度、positionEstimate/Confidence。
  - `snapshot.ts`：PerceptionSnapshot（地形摘要/可见角色物品地标/听觉事件/
    位置提示），不暴露地图宽高、全局坐标或未探索资源。
  - `server/navigation/`：orientation（PRD 19.3 sigma 公式、低置信度漂移、
    错路概率、地标/海岸/火光恢复）、exploration（frontier waypoint 只在
    explored∪visible 上选点，pathGrid allowed 谓词强制知识隔离）。
  - `FogOverlay.setFog`：认知数据 → 画布纹理（可见透明/已探索暗/未知黑）。
  - 测试：perception/navigation/orientation 12 项新增，unit 59/59；lint 0 error。

- P1 地图与渲染（commit `ab2b9d2` + 渲染集成）：
  - Tiled 源地图 256×192（`assets/source/mvp2/tiled/maps/aisland-mvp2.tmj` +
    `tilesets/terrain.tsj`/`decals.tsj`），四角 Wang 语义、构建期烘焙地面图集，
    运行时零 RGB 混色。
  - 自动校验全绿：wang 角一致性 0 违例、中心兼容 0、无透明/洋红、图集去重
    0.99、旅行 2027 岛上分钟（门槛 720）、绕行 49 格（门槛 40）、海岸特征 14、
    地形比例（占陆地）密林 32.9% / 疏林 15.2% / 岩地 21.6% / 湿地 9.2%。
  - 渲染：`src/components/pixi/map/*`（ChunkedTileLayer 用 @pixi/tilemap v4
    CompositeTilemap、相机剔除、MapScene 道具/树干/树冠前景分层、迷雾占位），
    `MapStage` 接入 GameView；浏览器实测地图可浏览、零 console 错误。
  - 服务端运行时：`server/engine/map/{runtimeMap,pathGrid,visibilityGrid}.ts`；
    单测 47/47 通过。
  - 资产与许可：Calciumtrice（CC-BY 4.0）+ Ninja Adventure（CC0）原图入库，
    `NOTICE-ASSETS.md` + `assets:audit` 校验。

- P0 基线冻结（分支、基线截图、测试记录）：
  - 分支 `agent/mvp2-spatial-survival` 自 `698617a` 创建。
  - 基线测试：typecheck 通过；lint 0 错误 1 警告；unit 42/42；integration 9/9。
  - 基线截图：`docs/mvp2-baseline/start-page.png`、`game-view.png`。
  - PRD V0.5 收入仓库（docx 根目录 + docs/PRD_MVP2_V0.5.txt）。

### 下一步

- P0-P8 已全部完成并验收（见上方 "P6/P7/P8 完成" 段与验收报告）。
- 可选的后续优化（非 PRD 门槛）：
  - 生存平衡：角色 5 日局仍会全灭（PRD 0.1-6 允许死亡）；如需更宽松，
    可调低需求速率 / 提高初始物资 / 增加浆果丛密度。
  - 部分局社交对话较少（LLM 随机性）；可增强相遇场景的交流触发。
  - 游戏 UI 打磨：角色动画帧按 facing 方向切换、火光夜间光照效果。

---

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
