import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { dispatch } from '../state/simBridge';
import { loadWorld } from '../sim/world';
import { playSound } from './audio';
import type { LogEntry } from '../sim/types';

const world = loadWorld();
const KIND_ICON: Record<string, string> = {
  war: '⚔',
  peace: '🕊',
  battle: '💥',
  capture: '🏳',
  diplomacy: '🤝',
  economy: '📉',
  research: '🔬',
  event: '📰',
  nuclear: '☢',
  production: '🏭',
  capitulation: '🏴',
  info: 'ℹ',
};

export function BottomBar() {
  const game = useGameStore((s) => s.game);
  const busy = useGameStore((s) => s.busy);
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
            data-tip="Click to fly to the location."
          >
            <span className="alert-icon">{KIND_ICON[a.kind] ?? '•'}</span>
            <span className="alert-text">{a.text}</span>
          </button>
        ))}
      </div>
      <div className="turn-controls">
        <button
          className="btn ghost"
          onClick={() => {
            setModal('summary');
            playSound('open');
          }}
          data-tip="Last month's summary (S)"
          data-testid="nav-summary"
        >
          Summary
        </button>
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
      <div className="ticker" ref={tickerRef} data-testid="ticker">
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
