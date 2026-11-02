/** Stylised leader card: flag, abstract generated portrait (no photos), name, title and trait bars (D-042). */
import { flagEmoji } from './flags';
import { Stat } from './Stat';
import type { LeaderMeta, NationMeta } from '../sim/world';
import { DEFAULT_TRAITS } from '../sim/world';

const TRAIT_LABELS: { key: keyof LeaderMeta['traits']; label: string; tip: string }[] = [
  {
    key: 'aggression',
    label: 'Aggression',
    tip: 'Willingness to use force and coercion. Drives the AI toward confrontation and higher military budgets.',
  },
  {
    key: 'riskTolerance',
    label: 'Risk',
    tip: 'Tolerance for gambles. High values accept attacks at worse odds and brinkmanship.',
  },
  {
    key: 'pragmatism',
    label: 'Pragmatism',
    tip: 'Preference for deals over ideology. High values accept pacts and trade more readily.',
  },
  {
    key: 'nationalism',
    label: 'Nationalism',
    tip: 'Sensitivity to demands and humiliation. High values refuse concessions.',
  },
  {
    key: 'paranoia',
    label: 'Paranoia',
    tip: 'Perceived threat level. High values seek defensive pacts and missile defence.',
  },
  {
    key: 'economicPriority',
    label: 'Economy',
    tip: 'Weight given to growth and research over arms.',
  },
  {
    key: 'allianceLoyalty',
    label: 'Loyalty',
    tip: 'Likelihood of honouring defence pacts when war comes.',
  },
  {
    key: 'nuclearThreshold',
    label: 'Nuclear bar',
    tip: 'How desperate the situation must be before nuclear use is considered. Higher is safer.',
  },
];

/** Deterministic abstract portrait from the ISO code: concentric geometry in the nation accent. */
function Portrait({ iso3, accent }: { iso3: string; accent: string }) {
  let h = 2166136261;
  for (const ch of iso3) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const r = (h >>> 0) % 360;
  const shapes = Array.from({ length: 5 }, (_, i) => {
    const a = ((h >>> (i * 5)) % 100) / 100;
    return {
      cx: 50 + Math.cos(r + i * 1.3) * 12 * a,
      cy: 46 + Math.sin(r + i * 1.7) * 10 * a,
      rad: 30 - i * 5,
      op: 0.18 + i * 0.12,
    };
  });
  return (
    <svg viewBox="0 0 100 100" className="portrait" aria-hidden="true">
      <defs>
        <radialGradient id={`g-${iso3}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0b1220" stopOpacity="1" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#g-${iso3})`} />
      {shapes.map((s, i) => (
        <circle
          key={i}
          cx={s.cx}
          cy={s.cy}
          r={s.rad}
          fill="none"
          stroke="#e8eef6"
          strokeOpacity={s.op}
          strokeWidth={1.2}
        />
      ))}
      <path d="M30 78 Q50 58 70 78 L70 100 L30 100 Z" fill="#0b1220" opacity="0.85" />
      <circle cx="50" cy="52" r="13" fill="#0b1220" opacity="0.85" />
      <circle cx="50" cy="52" r="13" fill="none" stroke={accent} strokeWidth="1.5" />
    </svg>
  );
}

interface Props {
  nation: NationMeta;
  leader: LeaderMeta | undefined;
  accent: string;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
}

/**
 * Offices other than the effective leader's: the head of state (and head of government when it is a
 * third person). Shown as secondary information; they do not drive the AI (D-049).
 */
export function SecondaryOffices({ leader }: { leader: LeaderMeta }) {
  const hos = leader.headOfState;
  const hog = leader.headOfGovernment;
  const lines: { label: string; holder: string }[] = [];
  if (hos.name !== leader.name)
    lines.push({ label: 'Head of state', holder: `${hos.title} ${hos.name}` });
  if (hog && hog.name !== leader.name && hog.name !== hos.name)
    lines.push({ label: 'Head of government', holder: `${hog.title} ${hog.name}` });
  const same = lines.length === 0;
  return (
    <div className="secondary-offices" data-testid="secondary-offices">
      {same && (
        <div
          className="leader-title dim"
          data-tip={`${leader.basis} ${leader.name} holds both offices.`}
        >
          Also head of state
        </div>
      )}
      {lines.map((l) => (
        <div
          key={l.label}
          className="leader-title dim"
          data-tip={`${l.label}. ${leader.basis} The AI personality and your role follow ${leader.name}.`}
        >
          {l.label}: {l.holder}
        </div>
      ))}
    </div>
  );
}

export function LeaderCard({
  nation,
  leader,
  accent,
  selected = false,
  compact = false,
  onClick,
}: Props) {
  const traits = leader?.traits ?? DEFAULT_TRAITS;
  return (
    <button
      className={`leader-card ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`}
      style={{ ['--accent' as string]: accent }}
      onClick={onClick}
      data-testid={`leader-${nation.iso3}`}
      type="button"
    >
      <div className="leader-top">
        <Portrait iso3={nation.iso3} accent={accent} />
        <div className="leader-id">
          <div className="leader-flag">
            {flagEmoji(nation.iso2)} <span className="leader-nation">{nation.name}</span>
          </div>
          <div className="leader-name" data-testid={`leader-name-${nation.iso3}`}>
            {leader?.name ?? 'Unknown leader'}
          </div>
          <div className="leader-title">{leader?.title ?? 'Leader'}</div>
          {!compact && leader && <SecondaryOffices leader={leader} />}
        </div>
      </div>
      {!compact && (
        <div className="trait-grid">
          {TRAIT_LABELS.map((t) => (
            <div key={t.key} className="trait" data-tip={`${t.tip} Score ${traits[t.key]}/100.`}>
              <span className="trait-label">{t.label}</span>
              <span className="trait-bar">
                <span className="trait-fill" style={{ width: `${traits[t.key]}%` }} />
              </span>
              <Stat value={traits[t.key]} tooltip={`${t.label}: ${t.tip}`} inline />
            </div>
          ))}
        </div>
      )}
      {!compact && leader?.rationale && <p className="leader-rationale">{leader.rationale}</p>}
    </button>
  );
}
