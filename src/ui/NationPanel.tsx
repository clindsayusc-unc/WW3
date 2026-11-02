import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { loadWorld } from '../sim/world';
import { Stat } from './Stat';
import { formatMoney, formatPct, formatPop } from './format';
import { LeaderCard, SecondaryOffices } from './LeaderCard';
import { nationHex } from '../render/palette';
import { dispatch } from '../state/simBridge';
import { unitUpkeep } from '../sim/economy';
import { researchPointsPerMonth } from '../sim/research';
import { enemiesOf, alliesOf } from '../sim/query';
import { playSound } from './audio';

const world = loadWorld();
const MOB_LABELS = ['Peacetime', 'Partial mobilisation', 'Total war economy'];

export function NationPanel() {
  const game = useGameStore((s) => s.game);
  const setModal = useUiStore((s) => s.setModal);
  if (!game) return null;
  const me = game.nations[game.player]!;
  const meta = world.nations.get(game.player)!;
  const leader = world.leaders.get(game.player);
  const upkeep = unitUpkeep(world, game, game.player);
  const rp = researchPointsPerMonth(world, game, game.player);
  const tech = me.researchCurrent ? world.techs.get(me.researchCurrent) : undefined;
  const enemies = enemiesOf(game, game.player);
  const allies = alliesOf(world, game, game.player);
  const units = Object.values(game.units).filter((u) => u.owner === game.player).length;
  return (
    <aside className="panel panel-left" data-testid="nation-panel">
      <LeaderCard nation={meta} leader={leader} accent={nationHex(game.player)} compact />
      {leader && <SecondaryOffices leader={leader} />}
      <div className="panel-section">
        <div className="row">
          <Stat
            label="Population"
            value={formatPop(me.population)}
            tooltip="Population (World Bank / IMF). Falls only through nuclear devastation."
          />
          <Stat
            label="Warheads"
            value={`${me.warheads}`}
            tooltip="Estimated nuclear warheads (FAS). Each strike expends ten. Zero means no deterrent."
          />
        </div>
        <div className="row">
          <Stat
            label="Forces"
            value={`${units}`}
            tooltip={`Formations under your command. Upkeep ${formatMoney(upkeep)} per month comes out of the military budget first; the remainder flows to the treasury for new production.`}
          />
          <Stat
            label="Research"
            value={`${rp.toFixed(0)} RP`}
            tooltip={`Research points per month: 10 × √(research spending in $bn), ×1.1 for great powers, minus 30 % × the sanctioners' share of world GDP (technology export controls), slowed by shortages of the current project's inputs (chips, rare earths…), plus tech bonuses. ${tech ? `Current: ${tech.name}, ${Math.round(me.researchPoints)}/${tech.cost}.` : 'No project selected — open Research (R).'}`}
          />
        </div>
        <div className="row">
          <Stat
            label="Debt"
            value={formatPct((me.debt / me.gdp) * 100, 0)}
            tooltip={`Public debt as a share of GDP. Interest (${me.interestRate.toFixed(1)}% a year, rising with inflation and debt) is paid from the debt-service budget; above 120% (or your starting level) growth suffers, and past the default line (at least 250%) you default.`}
          />
          <Stat
            label="Weariness"
            value={`${Math.round(me.warWeariness)}`}
            tooltip="War weariness grows every month at war (faster when losing ground) and drags stability down. Recovers in peace."
          />
        </div>
      </div>
      <div className="panel-section">
        <div className="section-title">Posture</div>
        <div className="seg">
          {MOB_LABELS.map((l, i) => (
            <button
              key={l}
              className={`seg-btn ${me.mobilization === i ? 'active' : ''}`}
              onClick={() => {
                playSound('click');
                dispatch({ type: 'setMobilization', level: i as 0 | 1 | 2 });
              }}
              data-tip={
                i === 0
                  ? 'Normal economy. No production bonus.'
                  : i === 1
                    ? 'Production costs −20%, growth −0.6 pp/yr, stability −0.4/month, tension +2.'
                    : 'Production costs −38% and builds 30% faster; growth −1.8 pp/yr, stability −1.2/month, tension +4.'
              }
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <div className="section-title">Standing</div>
        <div className="chips">
          {meta.blocs.map((b) => (
            <span
              key={b}
              className="chip"
              data-tip={`Member of ${b}. ${b === 'NATO' || b === 'CSTO' ? 'Mutual defence: an attack on one member brings the others in.' : 'Shared bloc membership improves baseline relations.'}`}
            >
              {b}
            </span>
          ))}
          {allies.slice(0, 6).map((a) => (
            <span
              key={a}
              className="chip ally"
              data-tip={`Defence pact with ${world.nations.get(a)?.name ?? a}.`}
            >
              ★ {world.nations.get(a)?.name ?? a}
            </span>
          ))}
          {enemies.map((e) => (
            <span
              key={e}
              className="chip enemy"
              data-tip={`At war with ${world.nations.get(e)?.name ?? e}.`}
            >
              ⚔ {world.nations.get(e)?.name ?? e}
            </span>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <div className="section-title">Budget split</div>
        <div
          className="budget-bar"
          onClick={() => setModal('budget')}
          data-tip={`Click to open the budget. Shares of government revenue (${me.taxRate}% of GDP per year).`}
        >
          {(['military', 'research', 'infrastructure', 'social', 'debt'] as const).map((k) => (
            <span key={k} className={`budget-seg ${k}`} style={{ width: `${me.budget[k]}%` }} />
          ))}
        </div>
        <div className="legend">
          {(
            [
              ['military', 'Mil'],
              ['research', 'Res'],
              ['infrastructure', 'Infra'],
              ['social', 'Social'],
              ['debt', 'Debt'],
            ] as const
          ).map(([k, label]) => (
            <Stat
              key={k}
              label={label}
              value={formatPct(me.budget[k], 0)}
              tooltip={`${k} share of monthly revenue (${formatMoney(me.finances.revenue)}).`}
            />
          ))}
        </div>
      </div>
      {me.aiNote === '' && (
        <div className="panel-hint">
          Press <kbd>Enter</kbd> to end the month. Right-click the map with units selected to move
          or attack.
        </div>
      )}
    </aside>
  );
}
