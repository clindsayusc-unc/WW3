/** Calibration (D-072): the same 10 seeds with every donor's aid suspended — Kyiv falls far more often. */
import { beforeAll, describe, expect, it } from 'vitest';
import { MONTHS, SEEDS, runUkraine, type UkraineRun } from '../../tests/ukraineRun';

let runs: UkraineRun[] = [];

describe(`calibration: Ukraine with aid cut (${SEEDS.length} seeds × ${MONTHS} months)`, () => {
  beforeAll(() => {
    runs = SEEDS.map((s) => runUkraine(s, false));
    console.log('\n[Ukraine, no aid]', runs.map((r) => `seed ${r.seed}: Kyiv ${r.kyivLost === null ? 'held' : `lost m${r.kyivLost}`}`).join('; '));
  }, 900_000);

  it('without aid Ukraine loses Kyiv in a large share of seeds', () => {
    const lost = runs.filter((r) => r.kyivLost !== null).length;
    expect(runs.every((r) => r.aidPerMonth === 0)).toBe(true);
    // Measured: 4 of 10 (months 4–6, two capitulations); with aid 0 of 10 (docs/BALANCE.md).
    expect(lost).toBeGreaterThanOrEqual(3);
  });

  it('no AI declares war on (or joins a war against) an ally', () => {
    expect(runs.flatMap((r) => r.allyWars)).toEqual([]);
  });
});
