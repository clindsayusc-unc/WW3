import { motion } from 'framer-motion';
import { useGameStore } from '../../state/gameStore';
import { loadWorld } from '../../sim/world';
import { formatMoney, formatMonth } from '../format';
import { nuclearStats } from '../../sim/escalation';
import { Stat } from '../Stat';

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
        {game.defeat?.kind === 'nuclearWar' && <NobodyWins />}
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

/** Sombre statistics of a full nuclear exchange (D-076). Numbers only — no imagery. */
function NobodyWins() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const st = nuclearStats(world, game);
  const lost = st.worldGdpStart > 0 ? Math.max(0, 1 - st.worldGdpNow / st.worldGdpStart) : 0;
  return (
    <div className="nobody-wins" data-testid="nobody-wins">
      <p className="dim">
        The exchange is over. Governments that remain issue statements to populations they can no longer reach. There is no victory to claim and no one left to
        claim it from.
      </p>
      <div className="end-stats">
        <Stat label="Detonations" value={`${st.detonations}`} tooltip="Nuclear weapons detonated over cities and military targets in this game." />
        <Stat
          label="People in struck regions"
          value={`${(st.populationStruck / 1e6).toFixed(0)} m`}
          tooltip="Population living in the regions that were struck, at the time of each strike. The simulation does not estimate deaths."
        />
        <Stat label="Nations struck" value={`${st.nationsStruck}`} tooltip="Nations whose territory was hit." />
        <Stat label="World output" value={formatMoney(st.worldGdpNow)} tooltip={`Annual output of the surviving economies, against ${formatMoney(st.worldGdpStart)} in January 2027 (${Math.round(lost * 100)} % lower).`} />
        <Stat label="Global cooling" value={`${st.cooling.toFixed(1)} °C`} tooltip="Average cooling from soot in the stratosphere. Harvests fail worldwide for years." />
        <Stat label="Warheads remaining" value={`${st.warheadsLeft}`} tooltip="Warheads still in the arsenals of the world." />
        <Stat label="Months from first use" value={`${st.monthsSinceFirstUse}`} tooltip="Time between the first nuclear detonation and the end." />
      </div>
    </div>
  );
}
