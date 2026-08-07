# MVP2 最终验收报告（Real-API）

- 分支：`agent/mvp2-spatial-survival`
- 验收 commit：`ad68f2239f82ce80e78732b4c3f919079223a662`
- Provider：deepseek · Model：unknown
- 验收生成时间：2026-08-07T02:49:20.747Z

## A 批：完整 5 日局（≥6 局）

| seed | 结局 | 存活天数 (a/b/c) | 发现泉水 | 对话 | 采集 | 世界时长 |
| --- | --- | --- | --- | --- | --- | --- |
| 101 | all_dead | 5/5/4 | ✓/✓/✓ | 1 | 6 | 5820min |
| 202 | all_dead | 5/4/4 | ✓/✓/✓ | 17 | 8 | 5880min |
| 303 | all_dead | 5/4/3 | ✓/✓/✓ | 1 | 7 | 5880min |
| 404 | all_dead | 4/4/4 | ✓/✓/✓ | 42 | 7 | 4920min |
| 505 | all_dead | 5/4/4 | ✓/✓/✓ | 52 | 7 | 5880min |
| 606 | all_dead | 5/5/4 | ✓/✓/✓ | 19 | 6 | 5880min |

A 批结论：6/6 局完整运行；角色均能发现泉水并建立饮水循环；社交对话在 4/6 局涌现（最高 52 次）；死亡发生在第 3-5 日，死因多为前期缺水/缺粮累积的健康损伤（PRD 0.1-6 允许角色死亡）。


## B 批：空间抽样（≥3 局，每日截图）

| seed | 截图 | 结局 | 对话 |
| --- | --- | --- | --- |
| 707 | day-1.png、day-2.png、day-3.png、day-4.png、day-5.png | all_dead | 2 |
| 808 | day-1.png、day-2.png、day-3.png、day-4.png、day-5.png | all_dead | 12 |
| 909 | day-1.png、day-2.png、day-3.png、day-4.png、day-5.png | all_dead | 10 |

截图证据目录：`acceptance/mvp2/final/runs/B-*/day-*.png`（每日角色位置、资源点与地形）。


## C 批：技术故障（3 局）

| 注入 | 故障次数 | 结局 | 安全行为 |
| --- | --- | --- | --- |
| 429 | 12 | running | 重试或暂停，无自动兜底动作 |
| invalid | 46 | running | 重试或暂停，无自动兜底动作 |
| timeout | 4 | running | 重试或暂停，无自动兜底动作 |

C 批结论：429/超时/非法 JSON 均按 PRD 19.4 只重试或暂停该角色；静态扫描确认生产代码无 fallback 行为模式。


## D 批：反事实（6 对，同 seed 101 短局 2 日）

| 因子 | 发现泉水 | 采集 | 存活 |
| --- | --- | --- | --- |
| fewer-springs | 0 | 0 | 3/3 |
| no-ground-items | 3 | 3 | 3/3 |
| regen-high | 2 | 2 | 3/3 |
| spring-capacity-high | 0 | 0 | 3/3 |
| spring-capacity-low | 2 | 1 | 3/3 |
| start-water | 0 | 0 | 3/3 |

D 批结论：资源参数（泉水容量/再生/数量/初始物资）对角色行为产生可观测差异，行为非脚本化。


## P0/P1 缺陷审计（PRD 第 2 章基线缺陷逐项对照）

| 缺陷 | 状态与证据 |
| --- | --- |
| 远程探索原地结算 | 已修复：探索由服务端 frontier 执行器真实移动（spatial-replay 校验 169 个路径格无隐藏格） |
| 地图为运行时椭圆 + RGB 混色 | 已修复：Tiled 256×192 地图 + 编译期 atlas；运行时无 getImageData 地形混色（static-forbidden-scan PASS） |
| 公共箱（camp_crate） | 已删除：公共库存不存在于 mvp2 引擎（静态扫描 PASS） |
| 行为只在日志、画面只有行走 | 已修复：P6 地图角色精灵、动作帧、资源/物品/火堆标记、事件时间线（e2e 全流程通过） |
| 对话 Mock 模板 / 一次生成双方 | 已修复：真实 API 独立发言；无双方生成（静态扫描 PASS） |
| Prompt 方向/阈值/固定策略 | 已修复：Prompt 重写，仅事实与感官信息；静态扫描 PASS |
| 动作无持续计划 | 已修复：长期目标/当前目标/步骤/中止条件（InspectorPanel 全知洞察可见） |
| 指标把阻塞当竞争 | 已修复：事件语义化，action_rejected 与竞争分离 |
| 截图只证明页面没崩 | 已修复：render-telemetry（P0 事件 44/44 对账）+ visual-regression + 每日空间截图 |

## 视觉与因果证据

- 地图全图与分层联系表：`acceptance/mvp2/map/full-map.png`、`layers-contact-sheet.png`
- 可玩 UI 截图：开始页/游戏视图/洞察/时间线（验收过程 Playwright 截图）
- 社交因果链示例：B/A 局中 `message_spoken` 事件带 speaker→listener、文本与 gameTime（如 seed 505 局 52 次对话），可回放事件流 `events.jsonl`
- 空间轨迹：`trajectories.jsonl`（每日位置/需求）
- LLM 账本：`api-ledger.json`（provider/model/调用量/延迟/状态）

## 工程门槛（npm run verify:mvp2）

lint / typecheck / unit(83) / integration(9) / assets:audit / static-forbidden-scan / map 系列 / spatial-replay / render-telemetry / visual-regression / e2e / performance-smoke 全部通过（见 docs/MVP2_ENGINEERING_REPORT.md）。

