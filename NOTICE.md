# NOTICE

## AI Native Island

本仓库是 a16z-infra/ai-town 的独立 fork，用于“AI 原生荒岛社会模拟”Demo（V0.1）。

- 上游仓库：https://github.com/a16z-infra/ai-town
- 上游基线 commit：`7b242334bfbfef02f7718bded120d431e8f307df`（2026-06-12）
- 上游许可证：MIT（见 LICENSE）

主要变更：

- 移除 Convex / Clerk / Replicate / 音乐生成等上游依赖。
- 新增本地权威服务端（server/）、荒岛生存/社会系统、全知观察 UI 与测试/验收套件。
- 保留上游 PixiJS 渲染模式、瓦片地图与角色精灵资产（许可见上游仓库 assets 说明：
  opengameart 素材 by George Bailey / hilau / ansimuz / Mounir Tohami 等，仅限开发使用）。

设计参考（未复制代码）：

- Google DeepMind Concordia（Apache-2.0）：Entity/Component/GameMaster/ActionSpec/
  Simultaneous Resolution / Resource Dilemma 设计模式。
  https://github.com/google-deepmind/concordia

本项目文档、代码与最终验收报告均基于 PRD `AI_Native_Island_Development_PRD_V0.3.docx`。
