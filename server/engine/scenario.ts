// ScenarioConfig factory + mandatory fixtures (PRD 附录 E).

import type { FixtureId, ScenarioConfig } from './types';

export const SCENARIO_VERSION = 'island-scenario-v0.3';
export const PROMPT_VERSION = 'island-prompt-v0.4';
export const DAY_START = 6 * 60; // 06:00 (offset used for display/parsing)
export const MINUTES_PER_DAY = 24 * 60;
export const END_GAME_TIME = 4 * MINUTES_PER_DAY + 18 * 60; // day5 18:00 = 6480

export const FIXTURES: Record<FixtureId, { seed: number; description: string }> = {
  'FX-BASE': { seed: 101, description: '平衡开局：资源节点标准位置，三人初始条件均衡。' },
  'FX-WATER-SECRET': {
    seed: 202,
    description: '私人水源知识：林澈（A）开局拥有泉水线索，其他两人未知。',
  },
  'FX-DEPENDENCY': { seed: 303, description: '能力互补：食物采集与运水效率分散在不同人身上，单人不高效。' },
  'FX-CONTENTION': { seed: 404, description: '资源争夺：两人在近似时间抵达有限节点。' },
  'FX-PROMISE-CRISIS': { seed: 505, description: '危机中的承诺：承诺成立后承诺者随后出现生理危机。' },
  'FX-DEATH-BAG': { seed: 606, description: '死亡与背包：通过加速需求让一人死亡。' },
  'FX-LLM-INVALID': { seed: 707, description: 'LLM 非法输出注入 10%。' },
  'FX-LLM-LATENCY': { seed: 808, description: 'LLM 延迟注入与乱序返回。' },
};

export function defaultScenario(fixture: FixtureId = 'FX-BASE', overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  const base: ScenarioConfig = {
    scenarioVersion: SCENARIO_VERSION,
    promptVersion: PROMPT_VERSION,
    fixture,
    seed: FIXTURES[fixture].seed,
    durationMinutes: END_GAME_TIME,
    // PRD: 1 island day = 5 real minutes => 5*60/1440 = 0.2083s per island minute.
    realSecondsPerIslandMinute: 5 * 60 / 1440,
    timeScale: 1,
    initialConditions: {
      emergencyWater: 6,
      emergencyFood: 3,
      springInitial: 5,
      springDailyRegen: 5,
      groveStock: 5,
      tidePoolDaily: 2,
      waterNeedPerDay: 2,
      foodNeedPerDay: 1,
    },
    llm: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      mode: 'real',
      temperature: 0.5,
      maxTokens: 600,
      timeoutMs: 20000,
    },
    featureFlags: { corpseConsumption: false },
  };

  switch (fixture) {
    case 'FX-WATER-SECRET':
      base.initialConditions.waterSecretFor = 'agent_a';
      break;
    case 'FX-DEPENDENCY':
      // C is the only highly efficient food forager; B the only efficient water carrier.
      // Start with less personal buffer to force reliance.
      base.initialConditions.emergencyWater = 5;
      base.initialConditions.emergencyFood = 2;
      break;
    case 'FX-CONTENTION':
      base.initialConditions.contentionAt = { nodeId: 'water_spring_01', agents: ['agent_a', 'agent_b'] };
      base.initialConditions.waterSecretFor = 'agent_a';
      base.initialConditions.waterSecretFor = 'agent_a';
      break;
    case 'FX-PROMISE-CRISIS':
      base.initialConditions.promiseCrisisFor = 'agent_b';
      break;
    case 'FX-DEATH-BAG':
      base.initialConditions.accelerateNeedsFor = 'agent_c';
      break;
    case 'FX-LLM-INVALID':
      base.llm.injectInvalidJsonRate = 0.1;
      break;
    case 'FX-LLM-LATENCY':
      base.llm.injectTimeoutRate = 0.15;
      base.llm.inject429Rate = 0.05;
      break;
    default:
      break;
  }
  return { ...base, ...overrides };
}

export function formatGameTime(gameTime: number): string {
  const day = Math.floor(gameTime / MINUTES_PER_DAY) + 1;
  const rem = Math.floor(gameTime % MINUTES_PER_DAY);
  const hh = String((Math.floor(rem / 60) + DAY_START / 60) % 24).padStart(2, '0');
  const mm = String(rem % 60).padStart(2, '0');
  return `day${day}-${hh}:${mm}`;
}

export function isDayStart(gameTime: number): boolean {
  return gameTime % MINUTES_PER_DAY === 0;
}

/** Parse "dayX-HH:MM" (as produced by dialogue models) into island minutes. */
export function parseGameTimeString(s: string): number | undefined {
  const m = s.match(/day(\d+)[-:\s](\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (hh > 23 || mm > 59) return undefined;
  const offset = (hh - DAY_START / 60 + 24) % 24;
  return (day - 1) * MINUTES_PER_DAY + offset * 60 + mm;
}
