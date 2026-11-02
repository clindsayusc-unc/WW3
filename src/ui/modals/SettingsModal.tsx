import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Modal';
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
  type SaveMeta,
} from '../../state/saves';
import { loadGame } from '../../state/simBridge';
import { playSound } from '../audio';
import { AudioSettingsPanel } from '../AudioSettings';
import { loadWorld } from '../../sim/world';

const world = loadWorld();

export function SettingsModal({ onMainMenu }: { onMainMenu: () => void }) {
  const game = useGameStore((s) => s.game);
  const ui = useUiStore();
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => listSaves().then(setSaves);
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Modal title="Settings" subtitle="Graphics, audio and saves." testId="modal-settings">
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
