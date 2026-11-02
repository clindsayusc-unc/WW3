import { useGameStore } from '../state/gameStore';
import { dispatch } from '../state/simBridge';
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
            tooltip="Current turn number. Each turn represents one week of in-game time."
          />
          <Stat
            label="Date"
            value={game.date}
            tooltip="In-game calendar date at the start of this turn (campaign begins 2027-01-01)."
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
