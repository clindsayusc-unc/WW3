import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { loadWorld } from '../sim/world';
import { nationHex } from '../render/palette';
import { LeaderCard } from './LeaderCard';
import { GraphicsSettings } from './GraphicsSettings';
import { newGame, loadGame } from '../state/simBridge';
import { useUiStore } from '../state/uiStore';
import { loadAutosave, importSave, listSaves, loadSlot, type SaveMeta } from '../state/saves';
import type { GameState, PlayMode } from '../sim/types';
import { playSound } from './audio';
import { AudioSettingsPanel } from './AudioSettings';
import { formatMonth } from './format';
import { dateForTurn } from '../sim/game';

const world = loadWorld();

type Step = 'home' | 'mode' | 'scenario' | 'leader' | 'load' | 'settings';

export function MainMenu({ onStart }: { onStart: () => void }) {
  const [step, setStep] = useState<Step>('home');
  const [scenario, setScenario] = useState<'world-2027' | 'taiwan-crisis'>('world-2027');
  const [pick, setPick] = useState<string>('USA');
  const [withTutorial, setWithTutorial] = useState<boolean | null>(null);
  const ui0 = useUiStore.getState().prefs;
  // Simple is the default for a first game; afterwards the menu remembers the last choice (D-086).
  const [mode, setMode] = useState<PlayMode>(ui0.lastMode ?? 'simple');
  const [auto, setAuto] = useState<{ state: GameState; savedAt: number } | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const ui = useUiStore();
  useEffect(() => {
    loadAutosave().then(setAuto);
    listSaves().then(setSaves);
  }, []);
  const start = () => {
    playSound('endTurn');
    newGame({ seed: (Date.now() % 100000) + 1, player: pick, scenario, mode });
    useUiStore.getState().setPrefs({ lastMode: mode });
    useUiStore.getState().setReportSeen(0);
    useUiStore.getState().setMapMode('political');
    const tutorial = withTutorial ?? !ui.prefs.tutorialDone;
    useUiStore.getState().setTutorial({ active: tutorial, step: 0, startedTurn: 0 });
    onStart();
  };
  const resume = (s: GameState) => {
    loadGame(s);
    onStart();
  };
  return (
    <div className="menu" data-testid="main-menu">
      <motion.div
        className="menu-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="menu-brand">
          <div className="menu-kicker">A FICTIONAL SIMULATION · JANUARY 2027</div>
          <h1 className="menu-title">WORLD WAR 3</h1>
          <p className="menu-tag">
            Grand strategy on a living globe. Fourteen great powers. One decade to avoid the
            unthinkable.
          </p>
        </div>
        {step === 'home' && (
          <div className="menu-actions">
            <button
              className="btn primary big"
              onClick={() => {
                setStep('mode');
                playSound('open');
              }}
              data-testid="menu-new"
            >
              New Game
            </button>
            <button
              className="btn big"
              disabled={!auto}
              onClick={() => auto && resume(auto.state)}
              data-testid="menu-continue"
              data-tip={
                auto
                  ? `Autosave: ${world.nations.get(auto.state.player)?.name}, ${formatMonth(dateForTurn(auto.state.turn))}`
                  : 'No autosave yet.'
              }
            >
              Continue
            </button>
            <button
              className="btn big"
              onClick={() => {
                setStep('load');
                playSound('open');
              }}
              data-testid="menu-load"
            >
              Load
            </button>
            <button
              className="btn big"
              onClick={() => {
                setStep('settings');
                playSound('open');
              }}
              data-testid="menu-settings"
            >
              Settings
            </button>
            <p className="disclaimer">
              This is a work of fiction. Nations, leaders and events are simulated from public data
              (IMF, SIPRI, FAS, Natural Earth, NASA) and editorial estimates; real people appear
              only as names, titles and trait scores. Nothing here predicts or advocates anything.
            </p>
          </div>
        )}
        {step === 'mode' && (
          <div className="menu-step" data-testid="mode-step">
            <div className="section-title">How do you want to play?</div>
            <div className="scenario-grid mode-grid">
              <button
                className={`scenario ${mode === 'simple' ? 'selected' : ''}`}
                onClick={() => setMode('simple')}
                data-testid="mode-simple"
              >
                <h3>
                  Simple <span className="chip tiny">{ui0.lastMode === null ? 'recommended for your first game' : 'quick to learn'}</span>
                </h3>
                <p>
                  You make the big calls — war or peace, friends and enemies, how much to spend on
                  the army — on a few cards each month. Your ministers run everything else.
                </p>
              </button>
              <button
                className={`scenario ${mode === 'full' ? 'selected' : ''}`}
                onClick={() => setMode('full')}
                data-testid="mode-full"
              >
                <h3>Full</h3>
                <p>
                  Every lever is yours: budget, taxes, factories, research, every army and fleet,
                  treaties and the UN. For players who know the game.
                </p>
              </button>
            </div>
            <p className="hint">You can switch at any time in Settings without losing your game.</p>
            <div className="row between">
              <button className="btn ghost" onClick={() => setStep('home')}>
                Back
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setStep('scenario');
                  playSound('open');
                }}
                data-testid="mode-next"
              >
                Choose a scenario
              </button>
            </div>
          </div>
        )}
        {step === 'scenario' && (
          <div className="menu-step">
            <div className="section-title">Choose a scenario</div>
            <div className="scenario-grid">
              <button
                className={`scenario ${scenario === 'world-2027' ? 'selected' : ''}`}
                onClick={() => setScenario('world-2027')}
                data-testid="scenario-world"
              >
                <h3>World of 2027</h3>
                <p>
                  The world as it stands: the Ukraine war grinds on, the Gulf simmers, the Pacific
                  arms. Play the long game to 2040.
                </p>
              </button>
              <button
                className={`scenario ${scenario === 'taiwan-crisis' ? 'selected' : ''}`}
                onClick={() => setScenario('taiwan-crisis')}
                data-testid="scenario-taiwan"
              >
                <h3>Taiwan Strait Crisis</h3>
                <p>
                  PLA amphibious groups put to sea as US carriers race west. Tension 90. Every month
                  could be the last of the old order.
                </p>
              </button>
            </div>
            <div className="row between">
              <button className="btn ghost" onClick={() => setStep('mode')}>
                Back
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setStep('leader');
                  playSound('open');
                }}
                data-testid="scenario-next"
              >
                Choose your nation
              </button>
            </div>
          </div>
        )}
        {step === 'leader' && (
          <div className="menu-step">
            <div className="section-title">
              Choose your nation — {world.nations.get(pick)?.name}
            </div>
            <div className="leader-grid" data-testid="leader-grid">
              {world.majors.map((iso) => (
                <LeaderCard
                  key={iso}
                  nation={world.nations.get(iso)!}
                  leader={world.leaders.get(iso)}
                  accent={nationHex(iso)}
                  selected={pick === iso}
                  compact
                  onClick={() => {
                    setPick(iso);
                    playSound('click');
                  }}
                />
              ))}
            </div>
            <div className="leader-detail">
              <LeaderCard
                nation={world.nations.get(pick)!}
                leader={world.leaders.get(pick)}
                accent={nationHex(pick)}
              />
            </div>
            <div className="row between">
              <button className="btn ghost" onClick={() => setStep('scenario')}>
                Back
              </button>
              <label className="toggle-row" data-tip={mode === 'simple' ? 'Five quick steps with your (fictional) chief of staff. Press H in game to replay it.' : 'Five guided months with your (fictional) chief of staff, highlighting each part of the screen. Press H in game to replay it.'}>
                <input
                  type="checkbox"
                  checked={withTutorial ?? !ui.prefs.tutorialDone}
                  onChange={(e) => setWithTutorial(e.target.checked)}
                  data-testid="tutorial-toggle"
                />
                Tutorial
              </label>
              <button className="btn primary big" onClick={start} data-testid="start-game">
                Begin — {formatMonth({ year: 2027, month: 1 })}
              </button>
            </div>
          </div>
        )}
        {step === 'load' && (
          <div className="menu-step">
            <div className="section-title">Load game</div>
            {saves.length === 0 && <p className="hint">No saves found.</p>}
            <div className="save-list">
              {saves.map((s) => (
                <div key={s.key} className="save-row">
                  <span className="name">{s.name}</span>
                  <span className="dim">
                    {world.nations.get(s.player)?.name ?? s.player} · {s.isoDate}
                  </span>
                  <button
                    className="btn small"
                    onClick={() => loadSlot(s.key).then((st) => st && resume(st))}
                  >
                    Load
                  </button>
                </div>
              ))}
            </div>
            <div className="row between">
              <button className="btn ghost" onClick={() => setStep('home')}>
                Back
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                Import JSON…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    importSave(f)
                      .then(resume)
                      .catch((err: Error) => alert(err.message));
                }}
              />
            </div>
          </div>
        )}
        {step === 'settings' && (
          <div className="menu-step">
            <GraphicsSettings />
            <div style={{ marginTop: 10 }}>
              <AudioSettingsPanel />
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              <button
                className={`chip toggle ${ui.showClouds ? 'on' : ''}`}
                onClick={ui.toggleClouds}
              >
                Clouds
              </button>
            </div>
            <div className="row between" style={{ marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setStep('home')}>
                Back
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
