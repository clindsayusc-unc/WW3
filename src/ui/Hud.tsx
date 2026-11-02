import { useGameStore } from '../state/gameStore';
import { dispatch } from '../state/simBridge';
import { formatMonth } from './format';
import { Stat } from './Stat';

export function Hud() {
  const game = useGameStore((s) => s.game);
  const error = useGameStore((s) => s.error);
  return (
    <div className="hud" data-testid="hud">
      <div className="hud-title">WORLD WAR 3</div>
      {game ? (
        <>
          <Stat
            label="Turn"
            value={game.turn + 1}
            tooltip="Current turn number. Each turn is one calendar month; turn 1 is January 2027."
          />
          <Stat
            label="Date"
            value={formatMonth(game.date)}
            tooltip="In-game month. The campaign begins in January 2027 and advances one month each time you end the turn."
          />
          <button
            className="end-turn"
            onClick={() => dispatch({ type: 'endTurn' })}
            data-testid="end-turn"
          >
            End Turn
          </button>
        </>
      ) : (
        <span>Starting simulation…</span>
      )}
      {error && <span className="hud-error">{error}</span>}
    </div>
  );
}
