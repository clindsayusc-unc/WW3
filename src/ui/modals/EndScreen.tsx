import { motion } from 'framer-motion';
import { useGameStore } from '../../state/gameStore';
import { loadWorld } from '../../sim/world';
import { formatMonth } from '../format';

const world = loadWorld();

export function EndScreen({
  onMainMenu,
  onContinue,
}: {
  onMainMenu: () => void;
  onContinue: () => void;
}) {
  const game = useGameStore((s) => s.game);
  if (!game || (!game.victory && !game.defeat)) return null;
  const win = game.victory;
  const title = win
    ? `${win.kind[0]!.toUpperCase()}${win.kind.slice(1)} Victory`
    : game.defeat!.kind === 'nuclearWar'
      ? 'Nobody Wins'
      : 'Defeat';
  return (
    <div className="modal-backdrop end-backdrop">
      <motion.div
        className={`end-screen ${win ? 'victory' : 'defeat'}`}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        data-testid="end-screen"
      >
        <div className="event-kicker">
          {formatMonth(game.date)} · {world.nations.get(game.player)?.name}
        </div>
        <h1>{title}</h1>
        <p>{win ? win.text : game.defeat!.text}</p>
        <div className="row">
          <button className="btn primary" onClick={onMainMenu}>
            Main menu
          </button>
          {!game.defeat && (
            <button className="btn ghost" onClick={onContinue}>
              Keep playing
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
