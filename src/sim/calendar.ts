/**
 * Pure month-based calendar for the campaign (1 turn = 1 calendar month, see
 * docs/DESIGN.md "Core loop"). Integer maths only, so src/sim never touches `Date`.
 */
export interface YearMonth {
  /** Calendar year, e.g. 2027. */
  readonly year: number;
  /** Calendar month, 1–12. */
  readonly month: number;
}

/** Adds `months` (which may be negative) to a year/month. */
export function addMonths(start: YearMonth, months: number): YearMonth {
  const index = start.year * 12 + (start.month - 1) + months;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** ISO-8601 year-month string, e.g. "2027-01". */
export function isoYearMonth({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}
