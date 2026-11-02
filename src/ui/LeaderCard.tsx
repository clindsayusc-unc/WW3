/** Stylised leader card: flag, abstract generated portrait (no photos), name, title and trait bars (D-042). */
import { flagEmoji } from './flags';
import { Stat } from './Stat';
import type { LeaderMeta, NationMeta, Traits } from '../sim/world';
import { DEFAULT_TRAITS } from '../sim/world';
import { Portrait } from './Portrait';

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

/** A fictional successor in office (D-078): replaces the researched leader's name and traits. */
export interface SuccessorView {
  name: string;
  title: string;
  traits: Traits;
  faction: string | null;
}

interface Props {
  nation: NationMeta;
  leader: LeaderMeta | undefined;
  successor?: SuccessorView | null | undefined;
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
  successor = null,
}: Props) {
  const traits = successor?.traits ?? leader?.traits ?? DEFAULT_TRAITS;
  const name = successor?.name ?? leader?.name ?? 'Unknown leader';
  const title = successor?.title ?? leader?.title ?? 'Leader';
  return (
    <button
      className={`leader-card ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`}
      style={{ ['--accent' as string]: accent }}
      onClick={onClick}
      data-testid={`leader-${nation.iso3}`}
      type="button"
    >
      <div className="leader-top">
        <Portrait iso3={nation.iso3} accent={accent} name={name} role={leader?.role} title={title} military={!!successor && /Military Council/.test(title)} />
        <div className="leader-id">
          <div className="leader-flag">
            {flagEmoji(nation.iso2)} <span className="leader-nation">{nation.name}</span>
          </div>
          <div className="leader-name" data-testid={`leader-name-${nation.iso3}`}>
            {name}
            {successor && (
              <span className="chip tiny" data-tip="A generated, fictional successor — not a real person. Traits come from the successor's party or faction profile, the national baseline and chance (D-078).">
                fictional
              </span>
            )}
          </div>
          <div className="leader-title">{title}</div>
          {successor?.faction && <div className="leader-title dim">{successor.faction}</div>}
          {!compact && leader && !successor && <SecondaryOffices leader={leader} />}
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
      {!compact && !successor && leader?.rationale && <p className="leader-rationale">{leader.rationale}</p>}
    </button>
  );
}
