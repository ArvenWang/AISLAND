# AI 原生荒岛 · AI Native Island（V0.1 Demo）

三名 AI 幸存者在稀缺资源荒岛上的五日社会模拟：合作、竞争、承诺、隐瞒与联盟由
需求、能力、私人知识与关系历史动态形成。玩家以全知视角观察每个真实动机。

本仓库是 [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) 的独立 fork
（基线 commit `7b242334`，MIT），按 PRD
`AI_Native_Island_Development_PRD_V0.3.docx` 实现。架构决策与模块说明见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 环境要求

- Node.js ≥ 20（开发使用 22）
- npm ≥ 10
- 浏览器：Chrome/Edge（Playwright 测试会自动安装 Chromium）
- 不需要 Docker、不需要数据库账号

## 安装

```bash
git clone <本仓库> ai-island
cd ai-island
npm install
cp .env.example .env   # 填入 LLM_API_KEY（DeepSeek 或任意 OpenAI 兼容服务）
```

## 启动（一条命令）

```bash
npm run dev
```

打开 http://localhost:5173 （Vite 前端，自动代理到本地权威服务端 :8787）。
生产模式：

```bash
npm run build
npm start               # http://localhost:8787
```

## 运行一局

1. 开始页选择场景（FX-BASE 平衡局 / FX-WATER-SECRET 私人水源知识 /
   FX-DEPENDENCY 能力互补 / FX-CONTENTION 资源争夺 /
   FX-PROMISE-CRISIS 危机中的承诺 / FX-DEATH-BAG 死亡背包 等）。
2. 输入随机种子；API 模式选“真实 API（DeepSeek）”或“确定性模拟”。
3. 速度 1x 约为 25 分钟一局；验收可用 4x/30x/120x。
4. 观察地图、角色卡、事件流、关系三角；点击角色卡查看真实动机/参数/知识/承诺。
5. 右上角可暂停/继续、导出 JSON 验收包；结束后自动进入结局页。

## API 配置

`.env` 关键变量：

```ini
LLM_PROVIDER=deepseek
LLM_API_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-v4-flash
LLM_MODE=real          # real | mock | replay
PORT=8787
```

密钥不会进入前端、日志、导出包或 Git（.env 已 gitignore）。

## 测试与验收命令

```bash
npm run lint                  # 静态检查
npm run typecheck             # 类型检查
npm run test:unit             # 单元测试（42 项）
npm run test:integration      # 集成测试（9 项）
npm run test:e2e              # Playwright 浏览器全路径（需要先启动服务端）
npm run test:sim              # headless 模拟批跑与行为指标
npm run acceptance:real-api -- --c 20 --d 3   # 真实 API 统计批 + 故障恢复批
npx tsx tests/acceptance/visible-runs.ts      # 5 局可见试玩（截图+导出包）
npm run acceptance:report     # 汇总最终验收报告
```

E2E 需要服务端已启动：先 `LLM_MODE=mock npm run dev`（或 `npm start`），再开另一个终端执行
`npm run test:e2e`。

## 目录结构

```text
server/          权威服务端（模拟引擎、LLM 适配、API、存档）
  engine/        确定性世界系统（需求/资源/动作/关系/承诺/事件/指标）
  llm/           Planner/Dialogue/Adapter（mock·replay·real）
  api/           HTTP + WebSocket
  save/          JSON 存档与导出包
src/             前端（React + PixiJS）
tests/           单元 / 集成 / E2E / 模拟 / 验收
docs/            架构、角色档案、进展、验收报告
data/ assets/    上游地图与精灵资产（保留 AI Town 素材与许可说明）
```

## 常见问题

- **开始页显示“后端离线”**：确认服务端已启动（`npm run dev` 或 `npm start`），检查 8787 端口。
- **真实 API 一直等待**：确认 `.env` 中 `LLM_API_KEY` 有效；DeepSeek 端点
  `https://api.deepseek.com/v1`；可用 `LLM_MODE=mock` 先验证游戏流程。
- **速度选择不生效**：速度在创建世界时写入；游戏中可通过顶部下拉实时调整。
- **导出包很大**：单 JSON 包含完整事件与终态，为验收证据，正常。
- **端口冲突**：`PORT=xxxx npm start` 或修改 vite 代理目标。

## 文档索引

- 架构与数据流：docs/ARCHITECTURE.md
- 角色参数与编译链：docs/CHARACTER_PROFILE.md
- 阶段进展：docs/DEVELOPMENT_PROGRESS.md（根目录 AGENT_PROGRESS.md 为汇总）
- 最终验收报告：docs/ACCEPTANCE_REPORT.md
