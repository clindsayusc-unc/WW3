import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Modal';
import { ScreenIcon } from '../icons';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { GraphicsSettings } from '../GraphicsSettings';
import {
  exportSave,
  importSave,
  listSaves,
  loadSlot,
  saveSlot,
  deleteSlot,
  savesLocation,
  type SaveMeta,
} from '../../state/saves';
import { dispatch, loadGame } from '../../state/simBridge';
import { toggleFullscreen } from '../../state/native';
import { playSound } from '../audio';
import { AudioSettingsPanel } from '../AudioSettings';
import { AccessibilitySettings } from '../AccessibilitySettings';
import { loadWorld } from '../../sim/world';

const world = loadWorld();

export function SettingsModal({ onMainMenu }: { onMainMenu: () => void }) {
  const game = useGameStore((s) => s.game);
  const ui = useUiStore();
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [savesDir, setSavesDir] = useState<string | null>(null);
  const refresh = () => listSaves().then(setSaves);
  useEffect(() => {
    void refresh();
    void savesLocation().then(setSavesDir);
  }, []);
  return (
    <Modal icon={<ScreenIcon id="settings" />} title="Settings" subtitle="Accessibility, graphics, audio and saves." testId="modal-settings">
      {game && (
        <>
          <div className="section-title">How you play</div>
          <div className="seg" role="radiogroup" aria-label="Play mode" data-testid="settings-mode">
            {(
              [
                ['simple', 'Simple', 'Your ministers run the economy, research, factories and armies; you answer a few Decision Cards each month.'],
                ['full', 'Full', 'Every lever by hand: budget, production, research, every unit, diplomacy and the UN.'],
              ] as const
            ).map(([id, label, tip]) => (
              <button
                key={id}
                className={`seg-btn ${(game.mode ?? 'full') === id ? 'active' : ''}`}
                role="radio"
                aria-checked={(game.mode ?? 'full') === id}
                data-tip={tip}
                data-testid={`settings-mode-${id}`}
                onClick={() => {
                  if ((game.mode ?? 'full') === id) return;
                  playSound('click');
                  dispatch({ type: 'setMode', mode: id });
                  ui.setPrefs({ lastMode: id });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">Switching keeps your game exactly as it is.</p>
        </>
      )}
      <div className="section-title">Accessibility &amp; guidance</div>
      <AccessibilitySettings />
      <GraphicsSettings />
      <div className="section-title">Display</div>
      <div className="chips">
        <button className={`chip toggle ${ui.showLabels ? 'on' : ''}`} onClick={ui.toggleLabels}>
          Labels (L)
        </button>
        <button className={`chip toggle ${ui.showClouds ? 'on' : ''}`} onClick={ui.toggleClouds}>
          Clouds
        </button>
        <button
          className="chip"
          onClick={() => void toggleFullscreen().catch(() => undefined)}
          data-tip="Fill the screen with the game, or return to a window (F11, or Ctrl ⌘ F on a Mac)."
          data-testid="fullscreen-toggle"
        >
          Fullscreen (F11)
        </button>
        <button
          className={`chip toggle ${ui.showChokepoints ? 'on' : ''}`}
          onClick={ui.toggleChokepoints}
          data-tip="Icons on the twelve maritime chokepoints showing open, contested or closed (key C)."
        >
          Chokepoints (C)
        </button>
      </div>
      <div className="section-title">Audio</div>
      <AudioSettingsPanel />
      <div className="section-title">Saves</div>
      {game && (
        <div className="row">
          <input
            className="input"
            placeholder="Save name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn small"
            onClick={() => {
              if (name.trim()) saveSlot(name.trim(), game).then(refresh);
              playSound('accept');
            }}
            disabled={!name.trim()}
          >
            Save
          </button>
          <button
            className="btn small ghost"
            onClick={() => exportSave(game)}
            data-tip="Download the current game as JSON."
            data-testid="export-save"
          >
            Export JSON
          </button>
          <button
            className="btn small ghost"
            onClick={() => fileRef.current?.click()}
            data-tip="Load a JSON save from disk."
          >
            Import JSON
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
                  .then((s) => {
                    loadGame(s);
                    ui.setModal(null);
                  })
                  .catch((err: Error) => alert(err.message));
            }}
          />
        </div>
      )}
      {savesDir && (
        <p className="hint" data-testid="saves-dir">
          Save files are kept in <code>{savesDir}</code>.
        </p>
      )}
      <div className="save-list">
        {saves.length === 0 && <p className="hint">No saves yet. The game autosaves every turn.</p>}
        {saves.map((s) => (
          <div key={s.key} className="save-row">
            <span className="name">{s.name}</span>
            <span className="dim">
              {world.nations.get(s.player)?.name ?? s.player} · {s.isoDate} · turn {s.turn + 1}
            </span>
            <button
              className="btn small"
              onClick={() =>
                loadSlot(s.key).then((st) => {
                  if (st) {
                    loadGame(st);
                    ui.setModal(null);
                    ui.setScreen('game');
                  }
                })
              }
            >
              Load
            </button>
            {s.key !== 'ww3.autosave' && (
              <button
                className="icon-btn"
                onClick={() => deleteSlot(s.key).then(refresh)}
                data-tip="Delete"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="section-title">Game</div>
      <button className="btn ghost" onClick={onMainMenu} data-testid="to-menu">
        Return to main menu
      </button>
    </Modal>
  );
}
