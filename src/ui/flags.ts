/** ISO 3166-1 alpha-2 → emoji flag (regional indicator symbols); no image assets needed. */
export function flagEmoji(iso2: string): string {
  if (!iso2 || iso2.length !== 2) return '🏳️';
  const base = 0x1f1e6;
  const a = iso2.toUpperCase().charCodeAt(0) - 65;
  const b = iso2.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return '🏳️';
  return String.fromCodePoint(base + a, base + b);
}
