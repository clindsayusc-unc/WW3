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
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "January 2027". */
export function formatMonth({ year, month }: YearMonth): string {
  return `${MONTHS[month - 1] ?? '?'} ${year}`;
}
export function formatMonthShort({ year, month }: YearMonth): string {
  return `${MONTHS_SHORT[month - 1] ?? '?'} ${year}`;
}

/** USD billions → "$1.23 trn" / "$456 bn" / "$12.3 bn" / "$850 m". */
export function formatMoney(bn: number, signed = false): string {
  const sign = bn < 0 ? '−' : signed && bn > 0 ? '+' : '';
  const v = Math.abs(bn);
  if (v >= 1000) return `${sign}$${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} trn`;
  if (v >= 100) return `${sign}$${v.toFixed(0)} bn`;
  if (v >= 10) return `${sign}$${v.toFixed(1)} bn`;
  if (v >= 1) return `${sign}$${v.toFixed(2)} bn`;
  return `${sign}$${(v * 1000).toFixed(0)} m`;
}

export function formatPct(v: number, digits = 1, signed = false): string {
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : '';
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
}

export function formatInt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

export function formatPop(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} bn`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} m`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} k`;
  return String(Math.round(v));
}

export function formatDelta(v: number, digits = 1): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
}

export const DEFCON_LABEL: Record<number, string> = {
  5: 'Peacetime readiness',
  4: 'Increased intelligence watch',
  3: 'Forces on alert',
  2: 'Armed forces ready to deploy in six hours',
  1: 'Maximum readiness — nuclear release authorised',
};
