import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Scene } from './render/Scene';
import { Hud, MapModeBar } from './ui/Hud';
import { NationPanel } from './ui/NationPanel';
import { ContextPanel } from './ui/ContextPanel';
import { BottomBar } from './ui/BottomBar';
import { MainMenu } from './ui/MainMenu';
import { BudgetModal } from './ui/modals/BudgetModal';
import { ProductionModal } from './ui/modals/ProductionModal';
import { ResearchModal } from './ui/modals/ResearchModal';
import { DiplomacyModal } from './ui/modals/DiplomacyModal';
import { MilitaryModal } from './ui/modals/MilitaryModal';
import { SummaryModal } from './ui/modals/SummaryModal';
import { SettingsModal } from './ui/modals/SettingsModal';
import { EventModal } from './ui/modals/EventModal';
import { NuclearModal } from './ui/modals/NuclearModal';
import { EndScreen } from './ui/modals/EndScreen';
import { useGameStore } from './state/gameStore';
import { useUiStore } from './state/uiStore';
import { autosave } from './state/saves';
import { useKeyboard } from './ui/useKeyboard';
import { loadQuality } from './render/quality';
import { playSound } from './ui/audio';

export function App() {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);
  const modal = useUiStore((s) => s.modal);
  const setModal = useUiStore((s) => s.setModal);
  const game = useGameStore((s) => s.game);
  const error = useGameStore((s) => s.error);
  const dismissedEnd = useUiStore((s) => s.modal === 'end');
  useKeyboard();
  useEffect(() => {
    useUiStore.getState().setQuality(loadQuality());
    // Dev/e2e hook: window.ww3.fly(lat, lon, distance), window.ww3.ui, window.ww3.game.
    (window as unknown as { ww3: unknown }).ww3 = {
      fly: (lat: number, lon: number, d?: number) => useUiStore.getState().fly(lat, lon, d),
      ui: useUiStore,
      game: useGameStore,
    };
  }, []);
  // Autosave after every state change once in game.
  useEffect(() => {
    if (game && screen === 'game') void autosave(game);
  }, [game, screen]);
  useEffect(() => {
    if (error) playSound('reject');
  }, [error]);
  const toMenu = () => {
    setModal(null);
    useGameStore.getState().reset();
    useUiStore.getState().select(null);
    setScreen('menu');
  };
  const ended = game && (game.victory || game.defeat) && !dismissedEnd;
  return (
    <>
      <Scene />
      {screen === 'menu' && <MainMenu onStart={() => setScreen('game')} />}
      {screen === 'game' && game && (
        <>
          <Hud />
          <MapModeBar />
          <NationPanel />
          <ContextPanel />
          <BottomBar />
          {game.nations[game.player]!.defcon === 1 &&
            game.nations[game.player]!.warheads > 0 &&
            modal !== 'nuclear' && (
              <button
                className="nuclear-btn"
                onClick={() => setModal('nuclear')}
                data-testid="nuclear-open"
                data-tip="DEFCON 1: nuclear release is available. Two confirmations required."
              >
                ☢ Nuclear options
              </button>
            )}
          <AnimatePresence>
            {modal === 'budget' && <BudgetModal key="budget" />}
            {modal === 'production' && <ProductionModal key="production" />}
            {modal === 'research' && <ResearchModal key="research" />}
            {modal === 'diplomacy' && <DiplomacyModal key="diplomacy" />}
            {modal === 'military' && <MilitaryModal key="military" />}
            {modal === 'summary' && <SummaryModal key="summary" />}
            {modal === 'settings' && <SettingsModal key="settings" onMainMenu={toMenu} />}
            {modal === 'nuclear' && <NuclearModal key="nuclear" />}
          </AnimatePresence>
          {game.pendingEvents.length > 0 && !modal && <EventModal />}
          {ended && <EndScreen onMainMenu={toMenu} onContinue={() => setModal('end')} />}
        </>
      )}
      {screen === 'game' && !game && (
        <div className="loading" data-testid="starting">
          <div className="loading-title">Preparing the world…</div>
        </div>
      )}
      {error && (
        <div
          className="toast error"
          role="alert"
          data-testid="error-toast"
          onClick={() => useGameStore.getState().setError('')}
        >
          {error}
        </div>
      )}
    </>
  );
}
