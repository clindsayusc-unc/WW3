import { describe, expect, it } from 'vitest';
import { addMonths, isoYearMonth } from './calendar';

describe('calendar', () => {
  it('adds months within a year', () => {
    expect(addMonths({ year: 2027, month: 1 }, 0)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2027, month: 1 }, 11)).toEqual({ year: 2027, month: 12 });
  });

  it('rolls over year boundaries in both directions', () => {
    expect(addMonths({ year: 2027, month: 12 }, 1)).toEqual({ year: 2028, month: 1 });
    expect(addMonths({ year: 2027, month: 1 }, 156)).toEqual({ year: 2040, month: 1 });
    expect(addMonths({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
    expect(addMonths({ year: 2027, month: 3 }, -27)).toEqual({ year: 2024, month: 12 });
  });

  it('formats ISO year-month', () => {
    expect(isoYearMonth({ year: 2027, month: 1 })).toBe('2027-01');
    expect(isoYearMonth({ year: 2040, month: 12 })).toBe('2040-12');
  });
});
