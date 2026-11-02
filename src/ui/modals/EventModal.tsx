import { motion } from 'framer-motion';
import { useGameStore } from '../../state/gameStore';
import { dispatch } from '../../state/simBridge';
import { playSound } from '../audio';

export function EventModal() {
  const game = useGameStore((s) => s.game);
  const ev = game?.pendingEvents[0];
  if (!game || !ev) return null;
  return (
    <div className="modal-backdrop event-backdrop">
      <motion.div
        className="modal event-modal"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        data-testid="event-modal"
        role="dialog"
        aria-label={ev.title}
      >
        <div className="event-kicker">Decision required</div>
        <h2>{ev.title}</h2>
        <p className="event-text">{ev.text}</p>
        <div className="event-choices">
          {ev.choices.map((c, i) => (
            <button
              key={i}
              className="choice"
              onClick={() => {
                dispatch({ type: 'resolveEvent', pendingId: ev.id, choice: i });
                playSound('accept');
              }}
              data-tip={c.tooltip}
              data-testid={`choice-${i}`}
            >
              <span className="choice-label">{c.label}</span>
              <span className="choice-tip">{c.tooltip}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
