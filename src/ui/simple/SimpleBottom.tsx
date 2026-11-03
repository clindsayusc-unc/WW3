/** Simple mode: the one big End Turn button and the end-of-turn report (D-086). */
import { motion } from 'framer-motion';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld } from '../../sim/world';
import { decisionCards } from '../../sim/simple';
import { formatMonth } from '../format';
import { dateForTurn } from '../../sim/game';
import { playSound } from '../audio';

const world = loadWorld();

export function SimpleEndTurn() {
  const game = useGameStore((s) => s.game);
  const busy = useGameStore((s) => s.busy);
  if (!game) return null;
  const left = decisionCards(world, game).length;
  const canEnd = !busy && !game.victory && !game.defeat;
  return (
    <div className="s-bottom">
      <button
        className={`end-turn s-end-turn ${busy ? 'busy' : ''}`}
        disabled={!canEnd}
        onClick={() => {
          playSound('endTurn');
          dispatch({ type: 'endTurn' });
        }}
        data-testid="end-turn"
        data-tip={
          left > 0
            ? `End the month (Enter). ${left} decision${left === 1 ? '' : 's'} left open: your ministers will take the first choice on any crisis and leave the rest as they are.`
            : 'End the month (Enter). Your ministers act, armies move and the world answers.'
        }
      >
        <span>{busy ? 'The month unfolds…' : 'End Turn'}</span>
        {!busy && <span className="s-end-next">to {formatMonth(dateForTurn(game.turn + 1))}</span>}
      </button>
    </div>
  );
}

/** Three short bullets about the month just resolved; shown once per month. */
export function TurnReport() {
  const game = useGameStore((s) => s.game);
  const seen = useUiStore((s) => s.reportSeen);
  if (!game?.simple || game.simple.reportTurn < 0 || game.simple.reportTurn + 1 !== game.turn || seen >= game.turn) return null;
  if (game.victory || game.defeat) return null;
  const close = () => {
    playSound('close');
    useUiStore.getState().setReportSeen(game.turn);
  };
  return (
    <div className="modal-backdrop s-report-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <motion.div
        className="s-report"
        data-testid="turn-report"
        role="dialog"
        aria-label="What happened last month"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="s-report-kicker">{formatMonth(dateForTurn(game.simple.reportTurn))} · what happened</div>
        <ul className="s-report-list">
          {game.simple.report.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <button className="btn primary big" onClick={close} data-testid="report-continue" autoFocus>
          Continue to {formatMonth(game.date)}
        </button>
      </motion.div>
    </div>
  );
}
