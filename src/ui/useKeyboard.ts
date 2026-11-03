import { useEffect } from 'react';
import { MAP_MODES, useUiStore } from '../state/uiStore';
import { useGameStore } from '../state/gameStore';
import { dispatch, undoLast } from '../state/simBridge';
import { playSound } from './audio';
import { toggleFullscreen } from '../state/native';

/** Global shortcuts (listed in src/ui/shortcuts.ts and the `?` overlay, D-080). */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      // Fullscreen works on every screen: F11, or Ctrl+⌘+F as in every Mac app (D-083).
      if (e.key === 'F11' || (e.ctrlKey && e.metaKey && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        void toggleFullscreen().catch(() => undefined);
        return;
      }
      if (ui.screen !== 'game') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return;
      const game = useGameStore.getState().game;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.key === '?') {
        ui.setModal(ui.modal === 'shortcuts' ? null : 'shortcuts');
        playSound('open');
        return;
      }
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
        n: 'news',
        x: 'escalation',
      };
      const k = e.key.toLowerCase();
      if (map[k] !== undefined && !e.metaKey && !e.ctrlKey) {
        ui.setModal(ui.modal === map[k] ? null : map[k]!);
        playSound('open');
        return;
      }
      if (k === 'a' && !e.metaKey && !e.ctrlKey) ui.setPrefs({ advisor: !ui.prefs.advisor });
      if (k === 'h' && !e.metaKey && !e.ctrlKey) ui.setTutorial({ active: true, step: 0 });
      if (k === 'l') ui.toggleLabels();
      if (k === 'c') ui.toggleChokepoints();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
