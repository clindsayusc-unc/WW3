import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, seedRng } from './rng';

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const run = (seed: number) => {
      let s = seedRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 100; i++) {
        const [v, n] = nextFloat(s);
        out.push(v);
        s = n;
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('produces values in [0,1)', () => {
    let s = seedRng(1);
    for (let i = 0; i < 10_000; i++) {
      const [v, n] = nextFloat(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      s = n;
    }
  });

  it('nextInt stays within inclusive bounds and hits both ends', () => {
    let s = seedRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const [v, n] = nextInt(s, 1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
      s = n;
    }
    expect(seen.size).toBe(6);
  });
});
