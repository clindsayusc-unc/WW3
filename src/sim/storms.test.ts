import { describe, expect, it } from 'vitest';
import { generateStorms, stormAt, MAX_STORMS } from './storms';

describe('storms', () => {
  it('is deterministic for the same seed and turn', () => {
    expect(generateStorms(42, 7, 8)).toEqual(generateStorms(42, 7, 8));
    expect(JSON.stringify(generateStorms(42, 7, 8))).not.toBe(
      JSON.stringify(generateStorms(43, 7, 8)),
    );
  });
  it('keeps storms in bounds and spins them by hemisphere', () => {
    for (let turn = 0; turn < 24; turn++) {
      const storms = generateStorms(1234, turn, (turn % 12) + 1);
      expect(storms.length).toBeLessThanOrEqual(MAX_STORMS);
      for (const s of storms) {
        expect(Math.abs(s.lat)).toBeLessThanOrEqual(70);
        expect(s.lon).toBeGreaterThanOrEqual(-180);
        expect(s.lon).toBeLessThanOrEqual(180);
        expect(s.intensity).toBeGreaterThan(0);
        expect(s.intensity).toBeLessThanOrEqual(1);
        expect(s.spin).toBe(s.lat >= 0 ? 1 : -1);
      }
    }
  });
  it('tropical cyclones follow the season', () => {
    let summerCyclones = 0;
    let winterCyclones = 0;
    for (let seed = 1; seed <= 40; seed++) {
      summerCyclones += generateStorms(seed, 8, 9).filter(
        (s) => s.kind === 'cyclone' && s.lat > 0,
      ).length;
      winterCyclones += generateStorms(seed, 1, 2).filter(
        (s) => s.kind === 'cyclone' && s.lat > 0,
      ).length;
    }
    expect(summerCyclones).toBeGreaterThan(winterCyclones * 3);
  });
  it('stormAt peaks at the centre and is zero far away', () => {
    const storms = generateStorms(9, 3, 9);
    const s = storms[0];
    if (!s) return;
    expect(stormAt(storms, s.lat, s.lon)).toBeCloseTo(s.intensity, 5);
    expect(stormAt([s], s.lat, s.lon + s.radiusDeg * 3)).toBe(0);
  });
});
