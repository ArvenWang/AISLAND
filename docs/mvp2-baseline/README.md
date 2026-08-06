# MVP2 P0 基线冻结（2026-08-07）

## 基线身份

- 开发分支：`agent/mvp2-spatial-survival`
- 基线 commit：`698617afc422c555b3472f35f10ce3e047d04895`（main @ 2026-08-06）
- 上游基线：a16z-infra/ai-town @ `7b242334bfbfef02f7718bded120d431e8f307df`
- 第二阶段任务书：`AI_Native_Island_MVP2_Development_PRD_V0.5.docx`（V0.5）

## 基线测试结果（P0）

| 检查 | 结果 |
| --- | --- |
| typecheck（tsc --noEmit） | Pass |
| lint（eslint .） | 0 errors，1 warning（AgentSprite pathPixelAt unused） |
| unit（jest） | 42/42 Pass |
| integration（jest） | 9/9 Pass |
| dev server 启动 | Pass（vite 5173 + API 8787） |

## 基线截图

- [start-page.png](start-page.png)：当前开始页（含 Fixture/seed/Mock 选择，MVP2 将删除）
- [game-view.png](game-view.png)：当前游戏画面（48×48 椭圆地图、公共箱、日志侧栏）

## 基线缺陷清单（对应 PRD 第 2 章审计）

1. 探索绕过空间：`explore` 折算旅行时间原地等待，可远程结算发现。
2. 地图运行时椭圆生成 + RGB 距离场混色，无 Tiled/Wang 源文件。
3. 出生点在岛屿中央；存在公共箱（camp_crate）与系统定义的公共库存。
4. 行为主要在日志中发生，画面只有行走。
5. 对话 Mock 模板硬编码；真实模式一次调用生成双方发言。
6. Planner Prompt 含资源方向提示、数值阈值命令与固定探索策略（违反 12.3）。
7. 无长期目标/计划；每次单动作选择，无中止条件。
8. metrics 把 harvest_blocked/action_interrupted 直接计为竞争。
9. 验收截图不校验地图、动画或因果链。

## 环境注意

- node_modules 经传输丢失执行位；本次已 `chmod -R u+x node_modules` 并清除
  quarantine。新环境请参照 README 安装。
- Playwright 浏览器未安装，可见运行使用系统 Chrome
  （`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`）。
