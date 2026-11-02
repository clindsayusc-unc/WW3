import { motion } from 'framer-motion';
import { useGameStore } from '../../state/gameStore';
import { dispatch } from '../../state/simBridge';
import { playSound } from '../audio';
import { loadWorld } from '../../sim/world';
import { describeEffect } from '../effectText';

const world = loadWorld();

export function EventModal() {
  const game = useGameStore((s) => s.game);
  const ev = game?.pendingEvents[0];
  if (!game || !ev) return null;
  const meta = world.eventById.get(ev.eventId);
  const chain = meta?.chain ? world.chains.find((c) => c.id === meta.chain) : undefined;
  const step = chain ? chain.steps.indexOf(ev.eventId) + 1 : 0;
  const ctx = { player: game.player, target: ev.target };
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
        <div className="event-kicker">
          {chain ? `Crisis · ${chain.name} · step ${step}` : 'Decision required'}
          {game.pendingEvents.length > 1 ? ` · ${game.pendingEvents.length - 1} more waiting` : ''}
        </div>
        <h2>{ev.title}</h2>
        <p className="event-text">{ev.text}</p>
        <div className="event-choices">
          {ev.choices.map((c, i) => {
            const effects = meta?.choices[i]?.effects ?? [];
            const chips = effects.map((e) => describeEffect(world, game, ctx, e)).filter((x) => x !== null);
            return (
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
                {chips.length > 0 && (
                  <span className="choice-effects">
                    {chips.map((chip, j) => (
                      <span key={j} className={`effect-chip ${chip.tone}`} data-tip={`Applied at once if you choose “${c.label}”. Green helps you, red hurts you.`}>
                        {chip.text}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="hint">If you end the month without deciding, the first option is taken.</p>
      </motion.div>
    </div>
  );
}
