import { useGameStore } from '../state/gameStore';
import { MAP_MODES, useUiStore } from '../state/uiStore';
import { formatMoney, formatMonth, formatPct, DEFCON_LABEL } from './format';
import { Stat } from './Stat';
import { loadWorld } from '../sim/world';
import { growthBreakdown } from '../sim/economy';
import { playSound } from './audio';
import { flagEmoji } from './flags';

const world = loadWorld();

export function Hud() {
  const game = useGameStore((s) => s.game);
  const modal = useUiStore((s) => s.modal);
  const setModal = useUiStore((s) => s.setModal);
  const fps = useUiStore((s) => s.fps);
  if (!game) return null;
  const me = game.nations[game.player]!;
  const meta = world.nations.get(game.player)!;
  const g = growthBreakdown(world, game, game.player);
  const growthTip = `Annualised growth. Base ${g.base.toFixed(1)}%, infrastructure ${g.infrastructure >= 0 ? '+' : ''}${g.infrastructure.toFixed(1)}, tech +${g.tech.toFixed(1)}, sanctions ${g.sanctions.toFixed(1)}, war ${g.war.toFixed(1)}, mobilisation ${g.mobilization.toFixed(1)}, debt ${g.debt.toFixed(1)}, events ${g.events >= 0 ? '+' : ''}${g.events.toFixed(1)}.`;
  const tensionClass = game.globalTension >= 80 ? 'danger' : game.globalTension >= 55 ? 'warn' : '';
  const open = (m: typeof modal) => {
    playSound('open');
    setModal(modal === m ? null : m);
  };
  return (
    <header className="topbar" data-testid="hud">
      <div className="brand">
        <span className="brand-title">WW3</span>
        <span className="brand-flag">{flagEmoji(meta.iso2)}</span>
        <span className="brand-nation">{meta.name}</span>
      </div>
      <div className="topbar-stats">
        <Stat
          label="Date"
          value={formatMonth(game.date)}
          tooltip={`Turn ${game.turn + 1}. One turn is one month; the campaign began in January 2027 and the Deterrence horizon is January 2040.`}
        />
        <Stat
          label="Treasury"
          value={formatMoney(me.treasury)}
          tooltip={`Cash available for production and emergencies. Last month: revenue ${formatMoney(me.finances.revenue)}, of which ${formatMoney(me.finances.production)} flowed into the treasury as unspent military budget. Debt ${formatMoney(me.debt)} (${formatPct((me.debt / me.gdp) * 100, 0)} of GDP).`}
        />
        <Stat
          label="GDP"
          value={formatMoney(me.gdp)}
          tooltip={`Annual nominal GDP of the home economy. Occupied regions stop contributing. Source at start: IMF WEO.`}
        />
        <Stat
          label="Growth"
          value={formatPct(me.growth, 1, true)}
          tooltip={growthTip}
          accent={me.growth < 0 ? '#f87171' : me.growth > 2.5 ? '#4ade80' : undefined}
        />
        <Stat
          label="Stability"
          value={`${Math.round(me.stability)}`}
          tooltip={`Public order, 0–100. Rises with social spending, growth and peace; falls with war weariness, mobilisation, debt and lost territory. Below 10 for three months means regime collapse. War weariness ${Math.round(me.warWeariness)}.`}
          accent={me.stability < 30 ? '#f87171' : me.stability < 50 ? '#fbbf24' : undefined}
        />
        <Stat
          label="Tension"
          value={`${Math.round(game.globalTension)}`}
          tooltip={`Global tension, 0–100: average flashpoint tension plus wars and mobilisations among the great powers. Drives DEFCON levels everywhere.`}
          className={tensionClass}
        />
        <Stat
          label="DEFCON"
          value={`${me.defcon}`}
          tooltip={`${DEFCON_LABEL[me.defcon] ?? ''}. Derived from global tension, your wars and nuclear threats. Nuclear release requires DEFCON 1.`}
          className={me.defcon <= 2 ? 'danger' : me.defcon === 3 ? 'warn' : ''}
        />
      </div>
      <nav className="topbar-nav">
        {(
          [
            ['budget', 'Budget', 'B'],
            ['production', 'Production', 'P'],
            ['research', 'Research', 'R'],
            ['diplomacy', 'Diplomacy', 'D'],
            ['military', 'Military', 'M'],
          ] as const
        ).map(([id, label, key]) => (
          <button
            key={id}
            className={`nav-btn ${modal === id ? 'active' : ''}`}
            onClick={() => open(id)}
            data-tip={`${label} (${key})`}
            data-testid={`nav-${id}`}
          >
            {label}
          </button>
        ))}
        <button
          className="nav-btn"
          onClick={() => open('settings')}
          data-tip="Settings, saves and quality"
          data-testid="nav-settings"
        >
          ⚙
        </button>
      </nav>
      <Stat
        value={`${fps}`}
        label="fps"
        tooltip="Frames per second. Dynamic resolution lowers render scale when a frame takes longer than 18 ms."
        className="fps"
      />
    </header>
  );
}

export function MapModeBar() {
  const mapMode = useUiStore((s) => s.mapMode);
  const setMapMode = useUiStore((s) => s.setMapMode);
  return (
    <div className="mapmodes" role="tablist" data-testid="mapmodes">
      {MAP_MODES.map((m) => (
        <button
          key={m.id}
          className={`mode-btn ${mapMode === m.id ? 'active' : ''}`}
          onClick={() => setMapMode(m.id)}
          data-tip={`${m.tooltip} (key ${m.key})`}
          data-testid={`mode-${m.id}`}
        >
          <span className="mode-key">{m.key}</span>
          {m.label}
        </button>
      ))}
    </div>
  );
}
