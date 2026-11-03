import { useGameStore } from '../state/gameStore';
import { MAP_MODES, useUiStore } from '../state/uiStore';
import { formatMoney, formatMonth, formatPct, DEFCON_LABEL } from './format';
import { Stat } from './Stat';
import { loadWorld } from '../sim/world';
import { playSound } from './audio';
import { flagEmoji } from './flags';
import { RESOURCE_IDS } from '../sim/types';
import { RESOURCE_COLOR } from './economyInfo';
import { ScreenIcon } from './icons';
import { HelpCircle } from 'lucide-react';
import { approvalRows, growthRows } from './breakdowns';

const world = loadWorld();

export function Hud() {
  const game = useGameStore((s) => s.game);
  const modal = useUiStore((s) => s.modal);
  const setModal = useUiStore((s) => s.setModal);
  const fps = useUiStore((s) => s.fps);
  if (!game) return null;
  const me = game.nations[game.player]!;
  const meta = world.nations.get(game.player)!;
  const left = me.nextElection !== null ? me.nextElection - game.turn : null;
  const recent = game.dispatches.filter((d) => d.turn >= game.turn - 1);
  const fresh = recent.length;
  const toMe = recent.filter((d) => d.to === game.player).length;
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
      <div className="topbar-stats" data-testid="topbar-stats">
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
          tooltip={`Annualised growth, the sum of the causes below.${me.recession ? ' The economy is in recession.' : ''} Open the Economy screen (E) for the full picture.`}
          breakdown={growthRows(world, game, game.player)}
          testId="hud-growth"
          accent={me.growth < 0 ? 'var(--bad)' : me.growth > 2.5 ? 'var(--good)' : undefined}
        />
        <Stat
          label="Inflation"
          value={formatPct(me.inflation, 1)}
          tooltip={`Consumer prices, % a year. Pushed up by deficits, mobilisation, import prices, shortages and sanctions; it erodes debt but drains approval. Interest on the debt ${formatPct(me.interestRate, 1)}.`}
          accent={me.inflation > 15 ? 'var(--bad)' : me.inflation > 6 ? 'var(--warn)' : undefined}
        />
        <Stat
          label="Approval"
          value={`${Math.round(me.support)}`}
          tooltip={`Public support for your government, 0–100: growth, prices, taxes, social spending, war weariness and shortages.${me.protestMonths > 0 ? ` Protests for ${me.protestMonths} months.` : ''}${left !== null ? ` Next election in ${left} months — losing it ends the game.` : ''}${me.coupRisk > 0.005 ? ` Coup risk ${(me.coupRisk * 100).toFixed(1)}% a month.` : ''}`}
          accent={me.support < 35 ? 'var(--bad)' : me.support < 45 ? 'var(--warn)' : undefined}
          className={left !== null && left <= 6 ? 'warn' : ''}
          breakdown={approvalRows(world, game, game.player)}
          testId="hud-approval"
        />
        <Stat
          label="Stability"
          value={`${Math.round(me.stability)}`}
          tooltip={`Public order, 0–100. Rises with social spending, growth and peace; falls with war weariness, mobilisation, debt and lost territory. Below 10 for three months means regime collapse. War weariness ${Math.round(me.warWeariness)}.`}
          accent={me.stability < 30 ? 'var(--bad)' : me.stability < 50 ? 'var(--warn)' : undefined}
        />
        <button className="stat-button" onClick={() => open('escalation')} data-testid="hud-tension">
          <Stat
            label="Tension"
            value={`${Math.round(game.globalTension)}`}
            tooltip={`Global tension, 0–100: average flashpoint tension plus wars and mobilisations among the great powers. Drives DEFCON levels everywhere. Click (or X) for the escalation ladder.`}
            className={tensionClass}
          />
        </button>
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
            ['economy', 'Economy', 'E'],
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
            <ScreenIcon id={id} size={15} />
            <span className="nav-label">{label}</span>
          </button>
        ))}
        <button
          className="nav-btn"
          onClick={() => {
            useUiStore.getState().setDiplomacyTab('dispatches');
            open('diplomacy');
          }}
          data-tip={`Diplomatic wire: statements from world leaders. ${fresh} new this month${toMe ? `, ${toMe} addressed to you` : ''}.`}
          data-testid="nav-dispatches"
        >
          <ScreenIcon id="wire" size={15} />
          <span className="nav-label">Wire</span>
          {fresh > 0 ? (
            <Stat value={fresh} tooltip={`${fresh} statements this month${toMe ? `, ${toMe} addressed to you` : ''}.`} className={`nav-badge ${toMe ? 'hot' : ''}`} inline />
          ) : null}
        </button>
        <button className="nav-btn icon-only" onClick={() => open('shortcuts')} data-tip="Keyboard shortcuts (?)" data-testid="nav-shortcuts" aria-label="Keyboard shortcuts">
          <HelpCircle size={16} aria-hidden="true" />
        </button>
        <button
          className="nav-btn icon-only"
          onClick={() => open('settings')}
          data-tip="Settings, accessibility, saves and quality"
          data-testid="nav-settings"
          aria-label="Settings"
        >
          <ScreenIcon id="settings" size={16} />
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
  const resourceView = useUiStore((s) => s.resourceView);
  const setResourceView = useUiStore((s) => s.setResourceView);
  return (
    <div className="mapmodes" role="tablist" data-testid="mapmodes">
      {mapMode === 'resources' && (
        <div className="mapmode-sub" data-testid="resource-picker">
          {RESOURCE_IDS.map((r) => (
            <button
              key={r}
              className={`mode-btn ${resourceView === r ? 'active' : ''}`}
              style={{ color: RESOURCE_COLOR[r] }}
              onClick={() => setResourceView(r)}
              data-tip={world.resourceById.get(r)?.description ?? r}
              data-testid={`resource-${r}`}
            >
              {world.resourceById.get(r)?.name ?? r}
            </button>
          ))}
        </div>
      )}
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
