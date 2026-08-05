// Deterministic seeded RNG for reproducible runs.

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.state = s || 0x9e3779b9;
  }

  /** Uniform [0, 1). */
  next(): number {
    // mulberry32
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.next() * (maxExclusive - min)) + min;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  get stateValue(): number {
    return this.state;
  }
}
