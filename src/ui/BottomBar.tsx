import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { dispatch, undoLast } from '../state/simBridge';
import { ScreenIcon } from './icons';
import { ALERT_ICON } from './iconMaps';
import { Info, Undo2 } from 'lucide-react';
import { loadWorld } from '../sim/world';
import { playSound } from './audio';
import type { LogEntry } from '../sim/types';

const world = loadWorld();

export function BottomBar() {
  const game = useGameStore((s) => s.game);
  const busy = useGameStore((s) => s.busy);
  const undo = useGameStore((s) => s.undo);
  const fly = useUiStore((s) => s.fly);
  const select = useUiStore((s) => s.select);
  const setModal = useUiStore((s) => s.setModal);
  const tickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!game) return;
    const alerts = game.log.filter((l) => l.turn === game.turn - 1 && l.alert);
    if (alerts.some((a) => a.kind === 'war' || a.kind === 'nuclear' || a.kind === 'capitulation'))
      playSound('alert');
  }, [game]);
  if (!game) return null;
  const alerts = game.log
    .filter((l) => l.alert && game.turn - l.turn <= 2)
    .slice(-12)
    .reverse();
  const headlines = game.news.length > 0 ? game.news : ['Diplomats talk; markets steady.'];
  const canEnd = !busy && !game.victory && !game.defeat && game.pendingEvents.length === 0;
  const goTo = (l: LogEntry) => {
    const region = l.region ?? (l.nations?.[0] ? world.capitalRegion.get(l.nations[0]) : undefined);
    const meta = region !== undefined ? world.regions.get(region) : undefined;
    if (meta) {
      fly(meta.lat, meta.lon, 1.6);
      select(meta.id);
    }
    // A battle alert opens its full report (D-059).
    if (l.kind === 'battle' && l.region !== undefined) {
      const report = game.battleReports.find((b) => b.region === l.region && b.turn === l.turn);
      if (report) useUiStore.getState().openBattleReport(report.id);
    }
    playSound('click');
  };
  return (
    <footer className="bottombar">
      <div className="alerts" data-testid="alerts">
        <div className="section-title">Alerts</div>
        {alerts.length === 0 && <div className="hint">Quiet month.</div>}
        {alerts.map((a, i) => (
          <button
            key={`${a.turn}-${i}`}
            className={`alert alert-${a.kind}`}
            onClick={() => goTo(a)}
            data-tip={a.kind === 'battle' ? 'Click to open the battle report.' : 'Click to fly to the location.'}
            data-testid={a.kind === 'battle' ? 'alert-battle' : undefined}
          >
            <span className="alert-icon">{(() => {
              const I = ALERT_ICON[a.kind] ?? Info;
              return <I size={14} aria-hidden="true" />;
            })()}</span>
            <span className="alert-text">{a.text}</span>
          </button>
        ))}
      </div>
      <div className="turn-controls">
        <div className="turn-row">
          <button
            className="btn ghost"
            onClick={() => {
              setModal('summary');
              playSound('open');
            }}
            data-tip="Last month's intelligence briefing (S)"
            data-testid="nav-summary"
          >
            <ScreenIcon id="summary" size={15} />
            Briefing
          </button>
          <button
            className="btn ghost"
            disabled={undo.length === 0 || busy}
            onClick={() => {
              undoLast();
              playSound('click');
            }}
            data-tip={undo.length ? `Undo: ${undo[undo.length - 1]} (Ctrl+Z). ${undo.length} order${undo.length === 1 ? '' : 's'} can be taken back this turn; wars, strikes and diplomacy cannot.` : 'Nothing to undo this turn. Moves, production, research and budget orders can be taken back until you end the turn.'}
            data-testid="undo"
          >
            <Undo2 size={15} aria-hidden="true" />
            Undo{undo.length ? ` (${undo.length})` : ''}
          </button>
        </div>
        <button
          className={`end-turn ${busy ? 'busy' : ''}`}
          disabled={!canEnd}
          onClick={() => {
            playSound('endTurn');
            dispatch({ type: 'endTurn' });
          }}
          data-testid="end-turn"
          data-tip={
            game.pendingEvents.length > 0
              ? 'Resolve the pending event first.'
              : 'End the month (Enter). The AI acts, the economy ticks, battles resolve.'
          }
        >
          {busy ? 'Resolving…' : game.pendingEvents.length > 0 ? 'Decision pending' : 'End Turn'}
          <span className="kbd">↵</span>
        </button>
      </div>
      <div
        className="ticker clickable"
        ref={tickerRef}
        data-testid="ticker"
        onClick={() => useUiStore.getState().setModal('news')}
        data-tip="Headlines of the month. Click (or press N) for the WW3 Wire."
      >
        <div className="ticker-track" key={game.turn}>
          {[...headlines, ...headlines].map((h, i) => (
            <span key={i} className="ticker-item">
              <span className="ticker-dot">◆</span>
              {h}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
