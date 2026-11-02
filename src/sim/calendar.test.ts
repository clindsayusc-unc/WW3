import { describe, expect, it } from 'vitest';
import { civilFromDays, daysFromCivil, isoDate } from './calendar';

describe('calendar', () => {
  it('matches the Unix epoch', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(isoDate(0)).toBe('1970-01-01');
  });

  it('round-trips across leap years and centuries', () => {
    for (let z = daysFromCivil(1999, 1, 1); z < daysFromCivil(2101, 1, 1); z += 13) {
      const { y, m, d } = civilFromDays(z);
      expect(daysFromCivil(y, m, d)).toBe(z);
    }
    expect(isoDate(daysFromCivil(2028, 2, 28) + 1)).toBe('2028-02-29');
    expect(isoDate(daysFromCivil(2100, 2, 28) + 1)).toBe('2100-03-01');
  });
});
