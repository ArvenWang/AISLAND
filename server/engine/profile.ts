// CharacterProfile single source of truth (PRD 7.4, 20.1-20.3).
// Every background fact maps to parameters that actually change mechanics,
// planner scoring, or relationship updates. No decorative settings.

import type { CharacterProfile } from './types';

export const PROFILE_VERSION = 'island-profiles-v0.3';

const A: CharacterProfile = {
  id: 'agent_a',
  name: '林澈',
  title: '户外救援队员',
  version: PROFILE_VERSION,
  physical: { strength: 55, endurance: 72, mobility: 65, metabolism: 50, painTolerance: 68 },
  skills: {
    navigation: 78,
    observation: 70,
    waterFinding: 68,
    foraging: 45,
    loadHandling: 52,
    harvestEfficiency: 55,
    negotiation: 50,
    plantKnowledge: 40,
    criticalNeedAssessment: 70,
  },
  personality: {
    empathy: 58,
    dominance: 44,
    riskTolerance: 48,
    impulsivity: 30,
    lossAversion: 52,
    conflictAvoidance: 55,
    honestyPreference: 65,
    reciprocitySensitivity: 60,
    futureOrientation: 62,
    normAdherence: 58,
  },
  moralCosts: { deceptionCost: 55, theftCost: 70, harmCost: 75, corpseConsumptionCost: 95 },
  experienceModifiers: [
    { id: 'mod_a_rescue', target: 'navigation', value: 18, sourceFactId: 'fact_a_1' },
    { id: 'mod_a_water', target: 'waterFinding', value: 15, sourceFactId: 'fact_a_1' },
    { id: 'mod_a_trust', target: 'initialTrust', value: 0, sourceFactId: 'fact_a_2' },
  ],
  backgroundFacts: [
    {
      id: 'fact_a_1',
      text: '我做过 5 年户外救援队员，常年执行山地搜索，擅长辨认路线和水源迹象，长距离探索比一般人可靠。',
      sourceParameterIds: ['physical.endurance', 'skills.navigation', 'skills.observation', 'skills.waterFinding', 'mod_a_rescue', 'mod_a_water'],
    },
    {
      id: 'fact_a_2',
      text: '我相信在野外，信息分享和稳定分工能提高所有人的生存概率。',
      sourceParameterIds: ['personality.empathy', 'personality.normAdherence', 'mod_a_trust'],
    },
  ],
  spriteSheet: 'f1',
};

const B: CharacterProfile = {
  id: 'agent_b',
  name: '石磊',
  title: '港口装卸工',
  version: PROFILE_VERSION,
  physical: { strength: 80, endurance: 62, mobility: 55, metabolism: 52, painTolerance: 60 },
  skills: {
    navigation: 45,
    observation: 48,
    waterFinding: 40,
    foraging: 50,
    loadHandling: 82,
    harvestEfficiency: 70,
    negotiation: 45,
    plantKnowledge: 35,
    criticalNeedAssessment: 55,
  },
  personality: {
    empathy: 47,
    dominance: 63,
    riskTolerance: 59,
    impulsivity: 47,
    lossAversion: 66,
    conflictAvoidance: 36,
    honestyPreference: 54,
    reciprocitySensitivity: 53,
    futureOrientation: 48,
    normAdherence: 42,
  },
  moralCosts: { deceptionCost: 40, theftCost: 55, harmCost: 60, corpseConsumptionCost: 90 },
  experienceModifiers: [
    { id: 'mod_b_carry', target: 'carryCapacity', value: 2, sourceFactId: 'fact_b_1' },
    { id: 'mod_b_heavy', target: 'loadHandling', value: 22, sourceFactId: 'fact_b_1' },
    { id: 'mod_b_scarcity', target: 'scarcitySensitivity', value: 30, sourceFactId: 'fact_b_2' },
  ],
  backgroundFacts: [
    {
      id: 'fact_b_1',
      text: '我长期做港口装卸和物资转运，力气大、扛得多、搬水搬货都很快；但我不太擅长在陌生地形里认路。',
      sourceParameterIds: ['physical.strength', 'physical.mobility', 'skills.loadHandling', 'skills.harvestEfficiency', 'skills.navigation', 'mod_b_carry', 'mod_b_heavy'],
    },
    {
      id: 'fact_b_2',
      text: '我在码头见过太多物资因为分配混乱而浪费，所以我会先保证自己手里的东西够用。',
      sourceParameterIds: ['personality.lossAversion', 'personality.dominance', 'mod_b_scarcity'],
    },
  ],
  spriteSheet: 'f4',
};

const C: CharacterProfile = {
  id: 'agent_c',
  name: '苏禾',
  title: '植物生态研究员',
  version: PROFILE_VERSION,
  physical: { strength: 42, endurance: 55, mobility: 60, metabolism: 48, painTolerance: 45 },
  skills: {
    navigation: 55,
    observation: 74,
    waterFinding: 50,
    foraging: 85,
    loadHandling: 38,
    harvestEfficiency: 62,
    negotiation: 58,
    plantKnowledge: 88,
    criticalNeedAssessment: 60,
  },
  personality: {
    empathy: 55,
    dominance: 39,
    riskTolerance: 41,
    impulsivity: 27,
    lossAversion: 56,
    conflictAvoidance: 61,
    honestyPreference: 63,
    reciprocitySensitivity: 69,
    futureOrientation: 70,
    normAdherence: 66,
  },
  moralCosts: { deceptionCost: 58, theftCost: 65, harmCost: 70, corpseConsumptionCost: 92 },
  experienceModifiers: [
    { id: 'mod_c_forage', target: 'foraging', value: 25, sourceFactId: 'fact_c_1' },
    { id: 'mod_c_plants', target: 'plantKnowledge', value: 30, sourceFactId: 'fact_c_1' },
    { id: 'mod_c_recip', target: 'reciprocitySensitivity', value: 10, sourceFactId: 'fact_c_2' },
  ],
  backgroundFacts: [
    {
      id: 'fact_c_1',
      text: '我是植物生态研究员，常年做野外样方调查，能认出可食用植物，也知道怎样减少无效采集；但我力气小，背不动太多水。',
      sourceParameterIds: ['physical.strength', 'skills.foraging', 'skills.observation', 'skills.plantKnowledge', 'skills.loadHandling', 'mod_c_forage', 'mod_c_plants'],
    },
    {
      id: 'fact_c_2',
      text: '我习惯用数据和事实说话，别人帮我一次，我会记得，也会尽量回报。',
      sourceParameterIds: ['personality.reciprocitySensitivity', 'personality.honestyPreference', 'mod_c_recip'],
    },
  ],
  spriteSheet: 'f3',
};

export const PROFILES: Record<string, CharacterProfile> = {
  agent_a: A,
  agent_b: B,
  agent_c: C,
};

export function getProfile(id: string): CharacterProfile {
  const p = PROFILES[id];
  if (!p) throw new Error(`Unknown profile ${id}`);
  return p;
}

// ---------------------------------------------------------------------------
// ProfileCompiler: parameters -> mechanics effects (PRD 20.1)
// ---------------------------------------------------------------------------

export type MechanicsEffects = {
  speedTilesPerMin: number;
  carryCapacity: number;
  harvestTimeMultiplier: Record<string, number>; // per resource kind
  harvestYieldBonus: Record<string, number>;
  discoveryBonus: Record<string, number>;
  exploreTimeMultiplier: number;
  needRateMultiplier: number;
  staminaCostMultiplier: number;
};

export function compileMechanics(profile: CharacterProfile): MechanicsEffects {
  const { physical, skills } = profile;
  const speed = 1.6 * (0.78 + physical.mobility / 240); // A:1.63 B:1.57 C:1.60 tiles/min
  const carryCapacity = Math.round(4 + physical.strength / 11 + (skills.loadHandling - 50) / 16);
  // A: 4+5+0.1=9; B: 4+7.3+2=13; C: 4+3.8-0.8=7
  const waterTime = 30 * (1 - (skills.harvestEfficiency - 50) / 180 - (skills.waterFinding - 50) / 300);
  const foodTime = 45 * (1 - (skills.foraging - 50) / 160 - (skills.harvestEfficiency - 50) / 400);
  const tideTime = 40 * (1 - (skills.foraging - 50) / 200);
  const discoveryBonus = {
    water: (skills.waterFinding - 50) / 2 + (skills.observation - 50) / 3, // +% chance
    food: (skills.foraging - 50) / 2 + (skills.observation - 50) / 3,
    general: (skills.observation - 50) / 2 + (skills.navigation - 50) / 4,
  };
  return {
    speedTilesPerMin: Math.round(speed * 100) / 100,
    carryCapacity,
    harvestTimeMultiplier: { water: waterTime / 30, food: foodTime / 45, tide: tideTime / 40 },
    harvestYieldBonus: {
      water: 0,
      food: Math.max(0, (skills.foraging - 60) / 100), // C: +0.25
      tide: Math.max(0, (skills.foraging - 60) / 120),
    },
    discoveryBonus,
    exploreTimeMultiplier: 1 - (skills.navigation - 50) / 250, // A: 0.89
    needRateMultiplier: 1 + (physical.metabolism - 50) / 250,
    staminaCostMultiplier: 1 - (physical.endurance - 50) / 300,
  };
}

// Natural-language explanation of parameters for the agent prompt.
export function promptSelfDescription(profile: CharacterProfile): string {
  const p = profile.personality;
  const parts: string[] = [];
  parts.push(`我的名字是${profile.name}，职业是${profile.title}。`);
  const phys = profile.physical;
  parts.push(
    `身体：力量${phys.strength}，耐力${phys.endurance}，行动力${phys.mobility}（数值越高越强，耐力影响体力消耗，行动力影响行走速度）。`,
  );
  const sk = profile.skills;
  parts.push(
    `技能：认路${sk.navigation}，观察${sk.observation}，找水${sk.waterFinding}，采集食物${sk.foraging}，负重搬运${sk.loadHandling}，采集效率${sk.harvestEfficiency}，植物知识${sk.plantKnowledge}。`,
  );
  parts.push(
    `人格（0-100）：同理心${p.empathy}（${p.empathy >= 60 ? '较容易感知他人痛苦' : p.empathy >= 45 ? '能体谅但有限度' : '更少被他人处境左右'}），控制欲${p.dominance}（${p.dominance >= 60 ? '倾向掌控资源与局面' : p.dominance <= 45 ? '不习惯强压他人' : '会维护自己的主张'}），风险偏好${p.riskTolerance}（${p.riskTolerance >= 55 ? '愿意承担中等偏高风险去探索' : p.riskTolerance <= 45 ? '危险或不确定时会收缩' : '风险接受度中等'}），冲动性${p.impulsivity}（${p.impulsivity >= 45 ? '更看重当下' : '能考虑较长期'}），损失厌恶${p.lossAversion}（${p.lossAversion >= 60 ? '很怕失去已有资源' : '对得失较坦然'}），冲突回避${p.conflictAvoidance}（${p.conflictAvoidance >= 58 ? '尽量避免正面冲突' : '不怕直接表达拒绝'}），诚实偏好${p.honestyPreference}（${p.honestyPreference >= 60 ? '说谎会让我不舒服' : '必要时可以说谎'}），互惠敏感度${p.reciprocitySensitivity}（${p.reciprocitySensitivity >= 62 ? '别人帮过我或伤过我都会强烈影响我的选择' : '对过往恩怨影响中等'}），未来导向${p.futureOrientation}（${p.futureOrientation >= 62 ? '会为后面几天做储备' : '更关注眼前'}），规范遵从${p.normAdherence}（${p.normAdherence >= 58 ? '在意公开承诺和群体规范' : '更务实'}）。`,
  );
  parts.push(...profile.backgroundFacts.map((f) => f.text));
  return parts.join('\n');
}

// Biography rendered from parameters for the UI (no free text in core logic).
export function renderBiography(profile: CharacterProfile): string {
  return `我是${profile.name}，${profile.title}。${profile.backgroundFacts.map((f) => f.text).join(' ')}`;
}

export function profileEffectCoverage(profile: CharacterProfile): {
  factIds: string[];
  usedParameterIds: string[];
  missing: string[];
} {
  const factIds = profile.backgroundFacts.map((f) => f.id);
  const used = new Set<string>();
  const collect = (ids: string[]) => ids.forEach((id) => used.add(id));
  profile.backgroundFacts.forEach((f) => collect(f.sourceParameterIds));
  profile.experienceModifiers.forEach((m) => used.add(m.target));
  const all = [
    ...Object.keys(profile.physical).map((k) => `physical.${k}`),
    ...Object.keys(profile.skills).map((k) => `skills.${k}`),
    ...Object.keys(profile.personality).map((k) => `personality.${k}`),
    ...Object.keys(profile.moralCosts).map((k) => `moralCosts.${k}`),
    ...profile.experienceModifiers.map((m) => `mod.${m.target}`),
  ];
  const missing = all.filter((k) => !used.has(k));
  return { factIds, usedParameterIds: [...used], missing };
}
