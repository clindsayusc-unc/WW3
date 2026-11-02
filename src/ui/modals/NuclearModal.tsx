import { useState } from 'react';
import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld, nationName } from '../../sim/world';
import { canLaunchNuclear, pickStrikeTarget } from '../../sim/escalation';
import { enemiesOf } from '../../sim/query';
import { playSound } from '../audio';

const world = loadWorld();

/** Two-step confirmation for nuclear release (D-028). */
export function NuclearModal() {
  const game = useGameStore((s) => s.game);
  const setModal = useUiStore((s) => s.setModal);
  const [target, setTarget] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  if (!game) return null;
  const me = game.nations[game.player]!;
  const enemies = enemiesOf(game, game.player);
  const t = target ?? enemies[0] ?? null;
  const why = t ? canLaunchNuclear(game, game.player, t) : 'No enemy.';
  const region = t ? pickStrikeTarget(world, game, t) : null;
  return (
    <Modal
      title="Nuclear Release"
      subtitle={`DEFCON ${me.defcon}. ${me.warheads} warheads. This cannot be undone.`}
      testId="modal-nuclear"
    >
      <p className="hint">
        A strike devastates the target's most populous region, destroys its forces there, shocks the
        world economy and turns every nation against you. Nuclear-armed victims retaliate with high
        probability. Eight detonations end the game for everyone.
      </p>
      <div className="row">
        <select
          className="select"
          value={t ?? ''}
          onChange={(e) => {
            setTarget(e.target.value);
            setArmed(false);
          }}
          data-testid="nuclear-target"
        >
          {enemies.map((e) => (
            <option key={e} value={e}>
              {nationName(world, e)}
            </option>
          ))}
        </select>
        {region !== null && <span className="dim">Target: {world.regions.get(region)?.name}</span>}
      </div>
      {why && <p className="danger-text">{why}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        {!armed ? (
          <button
            className="btn danger"
            disabled={!!why}
            onClick={() => {
              setArmed(true);
              playSound('alert');
            }}
            data-testid="nuclear-arm"
          >
            Arm (step 1 of 2)
          </button>
        ) : (
          <>
            <button
              className="btn danger pulse"
              onClick={() => {
                if (t && region !== null) dispatch({ type: 'nuclearStrike', target: t, region });
                setModal(null);
              }}
              data-testid="nuclear-launch"
            >
              CONFIRM LAUNCH
            </button>
            <button className="btn ghost" onClick={() => setArmed(false)}>
              Stand down
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
