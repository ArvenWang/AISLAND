import { Rng, hashString } from '../../server/engine/rng';

describe('Rng', () => {
  test('same seed produces same sequence', () => {
    const a = new Rng(101);
    const b = new Rng(101);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds produce different sequences', () => {
    const a = new Rng(101);
    const b = new Rng(202);
    expect(a.next()).not.toBe(b.next());
  });

  test('values in [0,1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('hashString is deterministic', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
    expect(hashString('hello')).not.toBe(hashString('world'));
  });
});
