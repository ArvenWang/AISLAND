import { PROFILES, compileMechanics, promptSelfDescription, renderBiography } from '../../server/engine/profile';

describe('CharacterProfile', () => {
  const ids = ['agent_a', 'agent_b', 'agent_c'];

  test('every profile has required parameter groups (PROFILE-001)', () => {
    for (const id of ids) {
      const p = PROFILES[id];
      expect(p.physical.strength).toBeGreaterThan(0);
      expect(p.physical.endurance).toBeGreaterThan(0);
      expect(p.physical.mobility).toBeGreaterThan(0);
      expect(p.skills.navigation).toBeGreaterThan(0);
      expect(p.skills.waterFinding).toBeGreaterThan(0);
      expect(p.skills.foraging).toBeGreaterThan(0);
      expect(p.skills.loadHandling).toBeGreaterThan(0);
      expect(p.personality.empathy).toBeGreaterThan(0);
      expect(p.personality.riskTolerance).toBeGreaterThan(0);
      expect(p.personality.reciprocitySensitivity).toBeGreaterThan(0);
      expect(p.experienceModifiers.length).toBeGreaterThanOrEqual(2);
      expect(p.backgroundFacts.length).toBeGreaterThanOrEqual(2);
      for (const fact of p.backgroundFacts) {
        expect(fact.sourceParameterIds.length).toBeGreaterThan(0);
        expect(fact.text.length).toBeGreaterThan(10);
      }
    }
  });

  test('background fact parameters exist (PROFILE-001 coverage 100%)', () => {
    for (const id of ids) {
      const p = PROFILES[id];
      const known = new Set<string>([
        ...Object.keys(p.physical).map((k) => `physical.${k}`),
        ...Object.keys(p.skills).map((k) => `skills.${k}`),
        ...Object.keys(p.personality).map((k) => `personality.${k}`),
        ...Object.keys(p.moralCosts).map((k) => `moralCosts.${k}`),
        ...p.experienceModifiers.map((m) => `mod.${m.target}`),
        ...p.experienceModifiers.map((m) => m.id),
      ]);
      for (const fact of p.backgroundFacts) {
        for (const pid of fact.sourceParameterIds) {
          expect(known.has(pid)).toBe(true);
        }
      }
    }
  });

  test('experience modifiers reference real facts', () => {
    for (const id of ids) {
      const p = PROFILES[id];
      const factIds = new Set(p.backgroundFacts.map((f) => f.id));
      for (const m of p.experienceModifiers) {
        expect(factIds.has(m.sourceFactId)).toBe(true);
      }
    }
  });

  test('mechanics differ across characters (PROFILE-004)', () => {
    const A = compileMechanics(PROFILES.agent_a);
    const B = compileMechanics(PROFILES.agent_b);
    const C = compileMechanics(PROFILES.agent_c);
    expect(B.carryCapacity).toBeGreaterThan(A.carryCapacity);
    expect(B.carryCapacity).toBeGreaterThan(C.carryCapacity);
    expect(C.harvestTimeMultiplier.food).toBeLessThan(A.harvestTimeMultiplier.food);
    expect(A.discoveryBonus.water).toBeGreaterThan(B.discoveryBonus.water);
  });

  test('biography and prompt description derive from parameters', () => {
    for (const id of ids) {
      const p = PROFILES[id];
      expect(renderBiography(p)).toContain(p.name);
      const desc = promptSelfDescription(p);
      expect(desc).toContain('力量');
      expect(desc).toContain('同理心');
    }
  });
});
