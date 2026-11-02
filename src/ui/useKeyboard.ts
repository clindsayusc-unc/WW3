import { useEffect } from 'react';
import { MAP_MODES, useUiStore } from '../state/uiStore';
import { useGameStore } from '../state/gameStore';
import { dispatch } from '../state/simBridge';
import { playSound } from './audio';

/** Global shortcuts: Enter = end turn, 1–7 map modes, B/P/R/D/M/E screens, Esc closes, L labels, C chokepoints. */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      if (ui.screen !== 'game') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return;
      const game = useGameStore.getState().game;
      if (e.key === 'Escape') {
        if (ui.modal) ui.setModal(null);
        else ui.select(null);
        return;
      }
      if (
        e.key === 'Enter' &&
        !ui.modal &&
        game &&
        !useGameStore.getState().busy &&
        !game.victory &&
        !game.defeat
      ) {
        if (game.pendingEvents.length > 0) return; // resolve events first
        playSound('endTurn');
        dispatch({ type: 'endTurn' });
        return;
      }
      const mode = MAP_MODES.find((m) => m.key === e.key);
      if (mode) {
        ui.setMapMode(mode.id);
        return;
      }
      const map: Record<string, Parameters<typeof ui.setModal>[0]> = {
        b: 'budget',
        p: 'production',
        r: 'research',
        d: 'diplomacy',
        m: 'military',
        e: 'economy',
        s: 'summary',
      };
      const k = e.key.toLowerCase();
      if (map[k] !== undefined && !e.metaKey && !e.ctrlKey) {
        ui.setModal(ui.modal === map[k] ? null : map[k]!);
        playSound('open');
        return;
      }
      if (k === 'l') ui.toggleLabels();
      if (k === 'c') ui.toggleChokepoints();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
