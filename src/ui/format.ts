import type { YearMonth } from '../sim/calendar';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "January 2027". */
export function formatMonth({ year, month }: YearMonth): string {
  return `${MONTHS[month - 1] ?? '?'} ${year}`;
}
