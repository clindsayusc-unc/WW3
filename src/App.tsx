import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Scene } from './render/Scene';
import { Hud, MapModeBar } from './ui/Hud';
import { NationPanel } from './ui/NationPanel';
import { ContextPanel } from './ui/ContextPanel';
import { BottomBar } from './ui/BottomBar';
import { MainMenu } from './ui/MainMenu';
import { EventModal } from './ui/modals/EventModal';
import { BreakingBanner, NewsModal } from './ui/modals/NewsModal';
import { TooltipLayer } from './ui/overlays/TooltipLayer';
import { ConfirmDialog } from './ui/overlays/ConfirmDialog';
import { AdvisorPanel } from './ui/AdvisorPanel';
import { SimpleHud, SimpleMapModes } from './ui/simple/SimpleHud';
import { DecisionCards } from './ui/simple/DecisionCards';
import { CountryPanel } from './ui/simple/CountryPanel';
import { SimpleEndTurn, TurnReport } from './ui/simple/SimpleBottom';
import { SIMPLE_MAP_MODES } from './state/uiStore';
import { useGameStore } from './state/gameStore';
import { loadGame } from './state/simBridge';
import { useUiStore } from './state/uiStore';
import { autosave } from './state/saves';
import { runAutoplayIfRequested } from './state/autoplay';
import { useKeyboard } from './ui/useKeyboard';
import { loadEffects, loadFlag, loadQuality, saveFlag } from './render/quality';
import { applyVolumes, loadAudioSettings, MUSIC_HINT_KEY, playSound } from './ui/audio';
import { musicIntensityFor, setMusicIntensity, startMusic, stopMusic } from './ui/music';

// Heavy screens load on first use (D-082): each is its own chunk, kept out of the startup bundle.
const BudgetModal = lazy(() =>
  import('./ui/modals/BudgetModal').then((m) => ({ default: m.BudgetModal })),
);
const ProductionModal = lazy(() =>
  import('./ui/modals/ProductionModal').then((m) => ({ default: m.ProductionModal })),
);
const ResearchModal = lazy(() =>
  import('./ui/modals/ResearchModal').then((m) => ({ default: m.ResearchModal })),
);
const DiplomacyModal = lazy(() =>
  import('./ui/modals/DiplomacyModal').then((m) => ({ default: m.DiplomacyModal })),
);
const MilitaryModal = lazy(() =>
  import('./ui/modals/MilitaryModal').then((m) => ({ default: m.MilitaryModal })),
);
const EconomyModal = lazy(() =>
  import('./ui/modals/EconomyModal').then((m) => ({ default: m.EconomyModal })),
);
const SummaryModal = lazy(() =>
  import('./ui/modals/SummaryModal').then((m) => ({ default: m.SummaryModal })),
);
const SettingsModal = lazy(() =>
  import('./ui/modals/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const NuclearModal = lazy(() =>
  import('./ui/modals/NuclearModal').then((m) => ({ default: m.NuclearModal })),
);
const BattleReportModal = lazy(() =>
  import('./ui/modals/BattleReportModal').then((m) => ({ default: m.BattleReportModal })),
);
const EscalationModal = lazy(() =>
  import('./ui/modals/EscalationModal').then((m) => ({ default: m.EscalationModal })),
);
const ShortcutsModal = lazy(() =>
  import('./ui/modals/ShortcutsModal').then((m) => ({ default: m.ShortcutsModal })),
);
const EndScreen = lazy(() =>
  import('./ui/modals/EndScreen').then((m) => ({ default: m.EndScreen })),
);
const TutorialOverlay = lazy(() =>
  import('./ui/tutorial/TutorialOverlay').then((m) => ({ default: m.TutorialOverlay })),
);
/** A lazily loaded screen; nothing shows for the few milliseconds its chunk takes to load. */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

export function App() {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);
  const modal = useUiStore((s) => s.modal);
  const setModal = useUiStore((s) => s.setModal);
  const game = useGameStore((s) => s.game);
  const error = useGameStore((s) => s.error);
  const dismissedEnd = useUiStore((s) => s.modal === 'end');
  const prefs = useUiStore((s) => s.prefs);
  const tutorialActive = useUiStore((s) => s.tutorial.active);
  useKeyboard();
  // Readability preferences (D-080): the palette switches semantic colours on the document root.
  useEffect(() => {
    document.documentElement.dataset.palette = prefs.palette;
  }, [prefs.palette]);
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
      load: loadGame,
    };
    // Packaged-app verification run (native only, D-083).
    void runAutoplayIfRequested();
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
  const simple = game?.mode === 'simple';
  // Simple mode shows the political map and, at war, the war view only (D-086).
  const mapMode = useUiStore((s) => s.mapMode);
  useEffect(() => {
    if (simple && !SIMPLE_MAP_MODES.includes(mapMode)) useUiStore.getState().setMapMode('political');
  }, [simple, mapMode]);
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
      <div
        className="ui-root"
        style={{ ['--ui-scale' as string]: prefs.uiScale }}
        data-advisor={screen === 'game' && game && !simple ? (prefs.advisor ? 'open' : 'closed') : 'none'}
        data-mode={simple ? 'simple' : 'full'}
        data-testid="ui-root"
      >
        {screen === 'menu' && <MainMenu onStart={() => setScreen('game')} />}
        {screen === 'game' && game && (
          <>
            {simple ? (
              <>
                <SimpleHud />
                <SimpleMapModes />
                <DecisionCards />
                <CountryPanel />
                <SimpleEndTurn />
              </>
            ) : (
              <>
                <Hud />
                <MapModeBar />
                <NationPanel />
                <ContextPanel />
                <AdvisorPanel />
                <BottomBar />
              </>
            )}
            {!simple &&
              game.nations[game.player]!.defcon === 1 &&
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
              {modal === 'budget' && (
                <Lazy key="budget">
                  <BudgetModal />
                </Lazy>
              )}
              {modal === 'production' && (
                <Lazy key="production">
                  <ProductionModal />
                </Lazy>
              )}
              {modal === 'research' && (
                <Lazy key="research">
                  <ResearchModal />
                </Lazy>
              )}
              {modal === 'diplomacy' && (
                <Lazy key="diplomacy">
                  <DiplomacyModal />
                </Lazy>
              )}
              {modal === 'military' && (
                <Lazy key="military">
                  <MilitaryModal />
                </Lazy>
              )}
              {modal === 'economy' && (
                <Lazy key="economy">
                  <EconomyModal />
                </Lazy>
              )}
              {modal === 'summary' && (
                <Lazy key="summary">
                  <SummaryModal />
                </Lazy>
              )}
              {modal === 'settings' && (
                <Lazy key="settings">
                  <SettingsModal onMainMenu={toMenu} />
                </Lazy>
              )}
              {modal === 'nuclear' && (
                <Lazy key="nuclear">
                  <NuclearModal />
                </Lazy>
              )}
              {modal === 'battle' && (
                <Lazy key="battle">
                  <BattleReportModal />
                </Lazy>
              )}
              {modal === 'escalation' && (
                <Lazy key="escalation">
                  <EscalationModal />
                </Lazy>
              )}
              {modal === 'news' && <NewsModal key="news" />}
              {modal === 'shortcuts' && (
                <Lazy key="shortcuts">
                  <ShortcutsModal />
                </Lazy>
              )}
            </AnimatePresence>
            {!modal && !simple && <BreakingBanner />}
            {game.pendingEvents.length > 0 && !modal && !simple && <EventModal />}
            {simple && !modal && <TurnReport />}
            {ended && (
              <Lazy>
                <EndScreen onMainMenu={toMenu} onContinue={() => setModal('end')} />
              </Lazy>
            )}
            {tutorialActive && (
              <Lazy>
                <TutorialOverlay />
              </Lazy>
            )}
          </>
        )}
        {screen === 'game' && !game && (
          <div className="loading" data-testid="starting">
            <div className="loading-title">Preparing the world…</div>
          </div>
        )}
        {screen === 'game' && game && !musicOn && !musicHintShown && !tutorialActive && !modal && (
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
            <button
              className="btn small ghost"
              onClick={dismissMusicHint}
              data-testid="music-hint-dismiss"
            >
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
        <ConfirmDialog />
        <TooltipLayer />
      </div>
    </>
  );
}
