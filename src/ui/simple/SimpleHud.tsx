/**
 * The Simple-mode HUD (D-086): four meters, the date, the goal line, one Advanced button and
 * Settings. Every number explains itself in plain words (rule 8).
 */
import { useState } from 'react';
import { Coins, Shield, Users, Radiation, Target, LayoutGrid, Flag, Swords } from 'lucide-react';
import { useGameStore } from '../../state/gameStore';
import { useUiStore, type MapMode, type Modal } from '../../state/uiStore';
import { loadWorld } from '../../sim/world';
import { goalProgress, managementStyle, nuclearDanger, strengthMeter, supportMeter, type Meter } from '../../sim/simple';
import { isAtWar } from '../../sim/query';
import { formatMoney, formatMonth } from '../format';
import { flagEmoji } from '../flags';
import { ScreenIcon } from '../icons';
import { Stat } from '../Stat';
import { playSound } from '../audio';

const world = loadWorld();

function MeterCard({
  icon,
  label,
  value,
  words,
  tone,
  fill,
  tooltip,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  words: string;
  tone: Meter['tone'];
  fill: number;
  tooltip: string;
  testId: string;
}) {
  return (
    <div className={`s-meter tone-${tone}`} data-testid={testId}>
      <span className="s-meter-icon">{icon}</span>
      <div className="s-meter-body">
        <div className="s-meter-head">
          <span className="s-meter-label">{label}</span>
          <Stat value={value} tooltip={tooltip} className="s-meter-value" />
        </div>
        <div className="s-meter-bar">
          <div style={{ width: `${Math.max(3, Math.min(100, fill))}%` }} />
        </div>
        <div className="s-meter-words">{words}</div>
      </div>
    </div>
  );
}

export function SimpleHud() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const me = game.nations[game.player]!;
  const meta = world.nations.get(game.player)!;
  const strength = strengthMeter(world, game);
  const danger = nuclearDanger(game);
  const support = supportMeter(me);
  const goal = goalProgress(world, game);
  const left = me.nextElection !== null ? me.nextElection - game.turn : null;
  const revenue = me.finances.revenue;
  const moneyTone: Meter['tone'] = me.treasury < revenue * 0.5 ? 'bad' : me.treasury < revenue * 2 ? 'neutral' : 'good';
  const moneyWords = moneyTone === 'good' ? 'Plenty in the bank' : moneyTone === 'neutral' ? 'Getting by' : 'Running short';
  return (
    <header className="s-topbar" data-testid="hud">
      <div className="s-brand">
        <span className="brand-flag">{flagEmoji(meta.iso2)}</span>
        <div>
          <div className="s-nation">{meta.name}</div>
          <div className="s-date" data-testid="s-date">
            <Stat
              value={formatMonth(game.date)}
              tooltip={`Each turn is one month. The game began in January 2027; you have until January 2040.`}
            />
          </div>
        </div>
      </div>
      <div className="s-meters" data-testid="topbar-stats">
        <MeterCard
          icon={<Coins size={18} aria-hidden="true" />}
          label="Money"
          value={formatMoney(me.treasury)}
          words={moneyWords}
          tone={moneyTone}
          fill={(me.treasury / Math.max(1, revenue * 4)) * 100}
          tooltip={`Cash in the national bank. Your ministers spend it on new forces; taxes bring in about ${formatMoney(revenue)} a month. Debt: ${formatMoney(me.debt)}.`}
          testId="meter-money"
        />
        <MeterCard
          icon={<Shield size={18} aria-hidden="true" />}
          label="Military strength"
          value={`${strength.value}`}
          words={strength.words}
          tone={strength.tone}
          fill={strength.value}
          tooltip={`Your armed forces compared with the strongest great power (100 = as strong as the strongest). You rank ${strength.rank} of ${strength.of}. Spend more on the military to grow it.`}
          testId="meter-military"
        />
        <MeterCard
          icon={<Users size={18} aria-hidden="true" />}
          label="Public support"
          value={`${support.value}`}
          words={support.words}
          tone={support.tone}
          fill={support.value}
          tooltip={`How many people back your government, out of 100. Wars, high prices and taxes lower it; a growing economy raises it.${left !== null ? ` Next election in ${left} months: lose it and the game ends.` : ' Very low support can bring protests or a coup.'}`}
          testId="meter-support"
        />
        <MeterCard
          icon={<Radiation size={18} aria-hidden="true" />}
          label="Danger of nuclear war"
          value={`${danger.value}`}
          words={`${danger.words} · DEFCON ${me.defcon} (5 = peace)`}
          tone={danger.tone}
          fill={danger.value}
          tooltip={`How close the world is to nuclear war, out of 100: tension between the great powers, and your own forces' alert level. DEFCON is that alert level: 5 means peacetime, 1 means ready to launch nuclear weapons. Yours is ${me.defcon}.`}
          testId="meter-danger"
        />
      </div>
      <div className="s-actions">
        <AdvancedButton />
        <button
          className="nav-btn icon-only"
          onClick={() => {
            playSound('open');
            useUiStore.getState().setModal(useUiStore.getState().modal === 'settings' ? null : 'settings');
          }}
          data-tip="Settings: switch between Simple and Full, saves, sound and display"
          data-testid="nav-settings"
          aria-label="Settings"
        >
          <ScreenIcon id="settings" size={18} />
        </button>
      </div>
      <div className="s-goal" data-testid="goal-tracker" data-tip={`${goal.detail} Your ministers run the economy, research, factories and armies (style: ${managementStyle(world, game)}); you make the big calls.`}>
        <Target size={15} aria-hidden="true" />
        <span className="s-goal-text">{goal.text}</span>
        <span className="s-goal-bar">
          <span style={{ width: `${Math.max(2, goal.pct)}%` }} />
        </span>
      </div>
    </header>
  );
}

const ADVANCED: { id: Exclude<Modal, null | 'settings' | 'load' | 'nuclear' | 'battle' | 'shortcuts' | 'end'>; label: string; tip: string }[] = [
  { id: 'budget', label: 'Budget', tip: 'How the money is split (your ministers set it in Simple mode).' },
  { id: 'economy', label: 'Economy', tip: 'Growth, trade, prices and resources.' },
  { id: 'production', label: 'Production', tip: 'What the factories are building.' },
  { id: 'research', label: 'Research', tip: 'The technology tree.' },
  { id: 'diplomacy', label: 'Diplomacy', tip: 'Every nation, treaty, bloc and UN vote.' },
  { id: 'military', label: 'Military', tip: 'Every army, fleet and air wing.' },
  { id: 'summary', label: 'Briefing', tip: 'Last month in detail.' },
  { id: 'escalation', label: 'Escalation', tip: 'The ladder from posturing to nuclear war.' },
  { id: 'news', label: 'News', tip: 'The WW3 Wire: every story this month.' },
];

/** The single door to every other screen (D-086). */
function AdvancedButton() {
  const [open, setOpen] = useState(false);
  const modal = useUiStore((s) => s.modal);
  return (
    <div className="s-advanced">
      <button
        className={`btn ${open ? 'primary' : ''}`}
        onClick={() => {
          playSound('click');
          setOpen(!open);
        }}
        data-tip="Every detailed screen of the full game. Your ministers keep running things unless you switch to Full mode in Settings."
        data-testid="advanced"
      >
        <LayoutGrid size={15} aria-hidden="true" /> Advanced
      </button>
      {open && (
        <div className="s-advanced-menu" data-testid="advanced-menu" role="menu">
          {ADVANCED.map((a) => (
            <button
              key={a.id}
              className={`nav-btn ${modal === a.id ? 'active' : ''}`}
              role="menuitem"
              data-tip={a.tip}
              data-testid={`adv-${a.id}`}
              onClick={() => {
                playSound('open');
                useUiStore.getState().setModal(a.id);
                setOpen(false);
              }}
            >
              <ScreenIcon id={a.id} size={15} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Political map, plus a war view while at war. */
export function SimpleMapModes() {
  const game = useGameStore((s) => s.game);
  const mapMode = useUiStore((s) => s.mapMode);
  const setMapMode = useUiStore((s) => s.setMapMode);
  if (!game || !isAtWar(game, game.player)) return null;
  const modes: { id: MapMode; label: string; tip: string; icon: React.ReactNode }[] = [
    { id: 'political', label: 'Countries', tip: 'Who controls each region.', icon: <Flag size={14} aria-hidden="true" /> },
    { id: 'military', label: 'War view', tip: 'Where the armies are: brighter regions hold more troops.', icon: <Swords size={14} aria-hidden="true" /> },
  ];
  return (
    <div className="mapmodes s-mapmodes" role="tablist" data-testid="mapmodes">
      {modes.map((m) => (
        <button key={m.id} className={`mode-btn ${mapMode === m.id ? 'active' : ''}`} onClick={() => setMapMode(m.id)} data-tip={m.tip} data-testid={`mode-${m.id}`}>
          {m.icon}
          {m.label}
        </button>
      ))}
    </div>
  );
}
