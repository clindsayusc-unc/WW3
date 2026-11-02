import { useState } from 'react';
import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { dispatch } from '../../state/simBridge';
import { Stat } from '../Stat';
import { formatMoney, formatPct } from '../format';
import type { Budget } from '../../sim/types';
import { playSound } from '../audio';

const KEYS: { key: keyof Budget; label: string; tip: string }[] = [
  {
    key: 'military',
    label: 'Military',
    tip: 'Pays unit upkeep first; the remainder flows into the treasury for production.',
  },
  {
    key: 'research',
    label: 'Research',
    tip: 'Research points per month scale with the square root of research spending.',
  },
  {
    key: 'infrastructure',
    label: 'Infrastructure',
    tip: 'Each point above 20% adds 0.03 pp of annual growth; below 20% subtracts.',
  },
  {
    key: 'social',
    label: 'Social',
    tip: 'Each point above 30% adds 0.02 stability per month; below 30% subtracts.',
  },
  {
    key: 'debt',
    label: 'Debt service',
    tip: 'Pays interest (4%/yr) first, then principal. Shortfalls are borrowed.',
  },
];

export function BudgetModal() {
  const game = useGameStore((s) => s.game);
  const me = game?.nations[game.player];
  // Local draft; re-seeded from the nation when the modal (re)opens.
  const [draft, setDraft] = useState<{ turn: number; b: Budget } | null>(null);
  const b: Budget =
    draft && draft.turn === (game?.turn ?? -1)
      ? draft.b
      : (me?.budget ?? { military: 20, research: 10, infrastructure: 20, social: 40, debt: 10 });
  const setB = (next: Budget) => setDraft({ turn: game?.turn ?? -1, b: next });
  if (!game || !me) return null;
  const total = KEYS.reduce((s, k) => s + b[k.key], 0);
  const revenue = me.finances.revenue || (me.gdp * 0.28) / 12;
  const setKey = (key: keyof Budget, value: number) => {
    // Keep the sum at 100 by taking/giving from the other categories proportionally.
    const next = { ...b, [key]: value };
    const others = KEYS.filter((k) => k.key !== key).map((k) => k.key);
    const otherSum = others.reduce((s, k) => s + next[k], 0);
    const target = 100 - value;
    if (otherSum > 0)
      for (const k of others) next[k] = Math.max(0, Math.round((next[k] / otherSum) * target));
    const drift = 100 - KEYS.reduce((s, k) => s + next[k.key], 0);
    const biggest = others.sort((x, y) => next[y] - next[x])[0]!;
    next[biggest] = Math.max(0, next[biggest] + drift);
    setB(next);
  };
  const apply = () => {
    dispatch({ type: 'setBudget', budget: b });
    playSound('accept');
  };
  return (
    <Modal
      title="National Budget"
      subtitle={`Monthly revenue ${formatMoney(revenue)} = 28% of GDP ÷ 12, scaled by territory you still control.`}
      testId="modal-budget"
      footer={
        <>
          <Stat
            label="Total"
            value={formatPct(total, 0)}
            tooltip="Allocations always sum to 100% of revenue."
          />
          <Stat
            label="Upkeep"
            value={formatMoney(me.finances.upkeep)}
            tooltip="Monthly cost of your formations, paid from the military share."
          />
          <Stat
            label="Interest"
            value={formatMoney(me.finances.interest)}
            tooltip="Monthly interest on public debt at 4% per year."
          />
          <button className="btn primary" onClick={apply} data-testid="budget-apply">
            Apply budget
          </button>
        </>
      }
    >
      <div className="budget-grid">
        {KEYS.map((k) => (
          <div key={k.key} className="budget-row">
            <div className="budget-label">
              <span className={`swatch ${k.key}`} />
              <span data-tip={k.tip}>{k.label}</span>
            </div>
            <input
              type="range"
              min={0}
              max={70}
              value={b[k.key]}
              onChange={(e) => setKey(k.key, Number(e.target.value))}
              aria-label={k.label}
              data-testid={`budget-${k.key}`}
            />
            <Stat
              value={formatPct(b[k.key], 0)}
              tooltip={`${k.tip} ≈ ${formatMoney((revenue * b[k.key]) / 100)} per month.`}
              inline
            />
          </div>
        ))}
      </div>
      <div className="finance-table">
        {(
          [
            [
              'Revenue',
              me.finances.revenue,
              'Taxes and other receipts: 28% of controlled GDP per year, divided by 12.',
            ],
            ['Military', me.finances.military, 'Military allocation (×1.1 while mobilised).'],
            [
              '— of which upkeep',
              me.finances.upkeep,
              'Formation upkeep, scaled by force quality and tech.',
            ],
            [
              '— to treasury',
              me.finances.production,
              'Unspent military money available for production.',
            ],
            ['Research', me.finances.research, 'Research spending.'],
            ['Infrastructure', me.finances.infrastructure, 'Infrastructure investment.'],
            ['Social', me.finances.social, 'Social spending.'],
            ['Debt service', me.finances.debtService, 'Interest and principal payments.'],
            [
              'Deficit',
              me.finances.deficit,
              'Interest not covered by debt service; borrowed automatically.',
            ],
          ] as const
        ).map(([label, v, tip]) => (
          <div key={label} className="finance-row">
            <span>{label}</span>
            <Stat value={formatMoney(v)} tooltip={`${tip} Last month's figure.`} inline />
          </div>
        ))}
      </div>
    </Modal>
  );
}
