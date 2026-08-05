# CHARACTER_PROFILE.md — 角色档案与编译链

角色唯一事实源：`server/engine/profile.ts`（PROFILES）。
人物小传只作为参数显示层渲染，游戏系统与 Prompt 都读取同一份结构化参数。

## 1. 三名角色

| 角色 | 职业 | 关键能力 | 机制效果 |
| --- | --- | --- | --- |
| 林澈 (A) | 户外救援队员 | 认路 78 / 观察 70 / 找水 68 / 耐力 72 | 探索耗时 -11%；水源发现率 +；移动稳定 |
| 石磊 (B) | 港口装卸工 | 力量 80 / 负重 82 / 采集效率 70 | 携带上限最高（13）；运水/采集更快；认路差 |
| 苏禾 (C) | 植物生态研究员 | 采集 85 / 植物知识 88 / 观察 74 | 食物采集耗时 -22%、产量 +25%；携带上限最低（7） |

## 2. 参数 → 效果编译链

`compileMechanics(profile)` 输出：

- `speedTilesPerMin`：由 mobility 决定（约 1.57-1.63 格/岛上分钟）。
- `carryCapacity`：由 strength 与 loadHandling 决定（A:9 / B:13 / C:7）。
- `harvestTimeMultiplier`：水/食物/潮池各自由 harvestEfficiency、waterFinding、foraging 决定。
- `harvestYieldBonus`：食物由 foraging 决定（C +25%）。
- `discoveryBonus`：水/食物/通用由 waterFinding、foraging、observation、navigation 决定。
- `exploreTimeMultiplier`：由 navigation 决定。
- `needRateMultiplier`：由 metabolism 决定。
- `staminaCostMultiplier`：由 endurance 决定。

连续人格（同理心/控制欲/风险偏好/冲动/损失厌恶/冲突回避/诚实/互惠/未来导向/规范遵从）
进入 Planner 上下文作为决策权衡系数，不定义角色类型；道德成本（欺骗/偷窃/伤害）仅用于
候选动作心理成本（Demo 未开放动作不参与选择）。

经历修正（experienceModifiers）：

- A：mod_a_rescue（navigation+18/waterFinding+15）、mod_a_trust（initialTrust+0）。
- B：mod_b_carry（carryCapacity+2）、mod_b_heavy（loadHandling+22）、mod_b_scarcity（scarcitySensitivity+30）。
- C：mod_c_forage（foraging+25）、mod_c_plants（plantKnowledge+30）、mod_c_recip（reciprocitySensitivity+10）。

## 3. 反事实参数敏感性

确定性断言（tests/unit/profile.test.ts）：

- B 携带上限 > A > C；C 食物采集时间 < A；A 水源发现加成 > B。
- 每条 background fact 的 sourceParameterIds 必须存在（PROFILE-001 覆盖率 100%）。
- 修改参数后 UI/Prompt 同步变化（renderBiography/promptSelfDescription 由参数生成）。

LLM 决策型人格反事实在真实 API 验收中通过配对采样观察（见 ACCEPTANCE_REPORT）。

## 4. 反作弊保证

- 角色没有“合作者/竞争者”字段；合作/竞争标签由 BehaviorAnalyzer 事后计算。
- 不允许按 agentId 写死行为分支；验收时通过 FX 场景交换初始处境验证行为跟随参数与境遇。
