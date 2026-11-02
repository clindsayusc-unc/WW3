/**
 * Illustrated leader portrait card (D-042, D-071): a stylised, generic bust in the nation's accent
 * with the leader's initials and an insignia for the office. Deliberately not a likeness — every
 * leader shares the same silhouette; only colour, monogram and insignia change. No photos.
 */
import type { LeaderRole } from '../sim/world';

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, '')
    .split(/[\s-]+/)
    .filter((p) => p.length > 0 && p[0] === p[0]!.toUpperCase() && !/^(bin|bint|al|el|da|de|van|von)$/i.test(p));
  if (parts.length === 0) return '?';
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

interface PortraitProps {
  iso3: string;
  accent: string;
  name?: string | undefined;
  role?: LeaderRole | undefined;
  /** Office title (monarchs get a crown). */
  title?: string | undefined;
  /** Military council or other non-civilian successor. */
  military?: boolean | undefined;
  size?: number | undefined;
  className?: string | undefined;
}

export function Portrait({ iso3, accent, name, role, title, military = false, size, className = '' }: PortraitProps) {
  const h = hash(iso3 + (name ?? ''));
  const id = `p-${iso3}-${h % 9973}`;
  const angle = h % 360;
  const mono = name ? initials(name) : iso3.slice(0, 2);
  // Office insignia: a star for party leaders and soldiers, a crown for monarchs, a laurel for presidents.
  const monarch = /\b(King|Emir|Sultan|Crown Prince|Prince)\b/.test(title ?? '');
  const insignia = military ? 'star' : monarch ? 'crown' : role === 'partyLeader' ? 'star' : role === 'supremeLeader' ? 'crescent' : role === 'headOfState' ? 'laurel' : 'bar';
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg viewBox="0 0 100 100" className={`portrait ${className}`} style={style} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-bg`} gradientTransform={`rotate(${angle % 90})`}>
          <stop offset="0%" stopColor={accent} stopOpacity="0.85" />
          <stop offset="100%" stopColor="#0b1220" stopOpacity="1" />
        </linearGradient>
        <radialGradient id={`${id}-halo`} cx="50%" cy="38%" r="45%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-coat`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={military ? '#3f4a2e' : '#1b2436'} />
          <stop offset="100%" stopColor="#070b14" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id}-bg)`} />
      {/* Engraved guilloche lines, the same for everyone but rotated per nation. */}
      <g opacity="0.18" stroke="#e8eef6" fill="none" strokeWidth="0.6" transform={`rotate(${angle} 50 50)`}>
        {[14, 22, 30, 38, 46].map((r) => (
          <ellipse key={r} cx="50" cy="50" rx={r + 6} ry={r} />
        ))}
      </g>
      <rect width="100" height="100" fill={`url(#${id}-halo)`} />
      {/* Bust: shoulders, collar and head — a generic silhouette, never a likeness. */}
      <path d="M14 100 C16 80 30 72 50 70 C70 72 84 80 86 100 Z" fill={`url(#${id}-coat)`} />
      <path d="M42 71 L50 86 L58 71 Z" fill="#e8eef6" opacity="0.85" />
      <path d="M48 74 L50 92 L52 74 Z" fill={accent} />
      <rect x="44" y="58" width="12" height="14" rx="4" fill="#1d2738" />
      <ellipse cx="50" cy="45" rx="15" ry="18" fill="#1d2738" />
      <ellipse cx="50" cy="45" rx="15" ry="18" fill="none" stroke={accent} strokeWidth="1.2" opacity="0.9" />
      <text x="50" y="50" textAnchor="middle" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="700" fill="#e8eef6" opacity="0.92">
        {mono}
      </text>
      <Insignia kind={insignia} accent={accent} />
      <rect x="0.5" y="0.5" width="99" height="99" fill="none" stroke={accent} strokeOpacity="0.5" />
    </svg>
  );
}

function Insignia({ kind, accent }: { kind: string; accent: string }) {
  const at = 'translate(76 82)';
  switch (kind) {
    case 'star':
      return <path transform={at} d="M0 -7 L2 -2 L7 -2 L3 1 L4.5 6 L0 3 L-4.5 6 L-3 1 L-7 -2 L-2 -2 Z" fill="#fbbf24" />;
    case 'crown':
      return <path transform={at} d="M-7 4 L-7 -4 L-3.5 0 L0 -6 L3.5 0 L7 -4 L7 4 Z" fill="#fbbf24" />;
    case 'crescent':
      return <path transform={at} d="M2 -6 A6 6 0 1 0 2 6 A4.5 4.5 0 1 1 2 -6 Z" fill="#e8eef6" />;
    case 'laurel':
      return (
        <g transform={at} fill="none" stroke="#e8eef6" strokeWidth="1.4">
          <path d="M-5 5 C-8 0 -6 -5 -2 -7" />
          <path d="M5 5 C8 0 6 -5 2 -7" />
        </g>
      );
    default:
      return <rect transform={at} x="-6" y="-2" width="12" height="4" rx="1" fill={accent} />;
  }
}
