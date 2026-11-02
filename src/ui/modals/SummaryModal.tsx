import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { Stat } from '../Stat';
import { formatMoney, formatMonth, formatDelta } from '../format';
import { dateForTurn } from '../../sim/game';

export function SummaryModal() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const s = game.summary;
  const entries = game.log.filter((l) => l.turn === game.turn - 1);
  return (
    <Modal
      title={s ? `Monthly report — ${formatMonth(dateForTurn(s.turn - 1))}` : 'Monthly report'}
      subtitle="What changed while the month resolved."
      testId="modal-summary"
    >
      {!s && <p className="hint">End your first turn to see a report.</p>}
      {s && (
        <div className="row wrap">
          <Stat
            label="GDP"
            value={formatMoney(s.gdpDelta, true)}
            tooltip="Change in annual GDP over the month."
            accent={s.gdpDelta < 0 ? '#f87171' : '#4ade80'}
          />
          <Stat
            label="Treasury"
            value={formatMoney(s.treasuryDelta, true)}
            tooltip="Net change in treasury after revenue, spending and purchases."
            accent={s.treasuryDelta < 0 ? '#f87171' : '#4ade80'}
          />
          <Stat
            label="Stability"
            value={formatDelta(s.stabilityDelta)}
            tooltip="Change in stability this month."
            accent={s.stabilityDelta < 0 ? '#f87171' : '#4ade80'}
          />
          <Stat label="Battles" value={`${s.battles}`} tooltip="Battles involving your forces." />
          <Stat
            label="Regions"
            value={`+${s.regionsGained} / −${s.regionsLost}`}
            tooltip="Regions gained and lost this month."
          />
          <Stat
            label="Techs"
            value={`${s.techsCompleted.length}`}
            tooltip={s.techsCompleted.join(', ') || 'None completed.'}
          />
        </div>
      )}
      <div className="section-title" style={{ marginTop: 12 }}>
        Headlines
      </div>
      <ul className="headline-list">
        {(s?.headlines ?? []).map((h, i) => (
          <li key={i}>{h}</li>
        ))}
        {(s?.headlines.length ?? 0) === 0 && <li className="hint">A quiet month.</li>}
      </ul>
      <div className="section-title" style={{ marginTop: 12 }}>
        Full log
      </div>
      <div className="log-list">
        {entries.map((l, i) => (
          <div key={i} className={`log-row log-${l.kind} ${l.alert ? 'alert-row' : ''}`}>
            {l.text}
          </div>
        ))}
        {entries.length === 0 && <div className="hint">Nothing logged.</div>}
      </div>
    </Modal>
  );
}
