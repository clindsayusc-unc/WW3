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
import { EconomyModal } from './ui/modals/EconomyModal';
import { SummaryModal } from './ui/modals/SummaryModal';
import { SettingsModal } from './ui/modals/SettingsModal';
import { EventModal } from './ui/modals/EventModal';
import { NuclearModal } from './ui/modals/NuclearModal';
import { BattleReportModal } from './ui/modals/BattleReportModal';
import { EndScreen } from './ui/modals/EndScreen';
import { useGameStore } from './state/gameStore';
import { useUiStore } from './state/uiStore';
import { autosave } from './state/saves';
import { useKeyboard } from './ui/useKeyboard';
import { loadEffects, loadFlag, loadQuality, saveFlag } from './render/quality';
import { applyVolumes, loadAudioSettings, MUSIC_HINT_KEY, playSound } from './ui/audio';
import { musicIntensityFor, setMusicIntensity, startMusic, stopMusic } from './ui/music';

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
    const q = loadQuality();
    useUiStore.getState().setQuality(q);
    useUiStore.getState().setEffects(loadEffects(q));
    useUiStore.getState().setStrikeCam(loadFlag('ww3.strikeCam', true));
    useUiStore.getState().setAudio(loadAudioSettings());
    useUiStore.getState().setMusicHintShown(loadFlag(MUSIC_HINT_KEY, false));
    // Dev/e2e hook: window.ww3.fly(lat, lon, distance), window.ww3.ui, window.ww3.game. Merged
    // into the existing object so hooks installed by the renderer (perf, screenPos, …) survive.
    const w = window as unknown as { ww3?: Record<string, unknown> };
    w.ww3 = {
      ...(w.ww3 ?? {}),
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
  // Music (D-060): plays in game when switched on, fades out otherwise; tension follows DEFCON.
  const musicOn = useUiStore((s) => s.audio.musicOn);
  const muted = useUiStore((s) => s.muted);
  const musicHintShown = useUiStore((s) => s.musicHintShown);
  useEffect(() => {
    applyVolumes(useUiStore.getState().audio, muted);
    if (musicOn && screen === 'game') startMusic();
    else stopMusic();
  }, [musicOn, muted, screen]);
  const defcon = game?.nations[game.player]?.defcon ?? 5;
  useEffect(() => {
    setMusicIntensity(musicIntensityFor(defcon));
  }, [defcon]);
  const dismissMusicHint = () => {
    useUiStore.getState().setMusicHintShown(true);
    saveFlag(MUSIC_HINT_KEY, true);
  };
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
            {modal === 'economy' && <EconomyModal key="economy" />}
            {modal === 'summary' && <SummaryModal key="summary" />}
            {modal === 'settings' && <SettingsModal key="settings" onMainMenu={toMenu} />}
            {modal === 'nuclear' && <NuclearModal key="nuclear" />}
            {modal === 'battle' && <BattleReportModal key="battle" />}
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
      {screen === 'game' && game && !musicOn && !musicHintShown && (
        <div className="toast hint-toast" role="status" data-testid="music-hint">
          <span>Music is off. Turn on the ambient bed in Settings (⚙) → Music.</span>
          <button
            className="btn small"
            onClick={() => {
              useUiStore.getState().setModal('settings');
              dismissMusicHint();
              playSound('open');
            }}
          >
            Open Settings
          </button>
          <button className="btn small ghost" onClick={dismissMusicHint} data-testid="music-hint-dismiss">
            Dismiss
          </button>
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
