import { useUiStore } from '../state/uiStore';
import { UI_SCALE_MAX, UI_SCALE_MIN } from './prefs';
import { Stat } from './Stat';
import { playSound } from './audio';

/** Readability and guidance settings (D-080): UI scale, palettes, confirmations, advisor, tutorial. */
export function AccessibilitySettings() {
  const prefs = useUiStore((s) => s.prefs);
  const setPrefs = useUiStore((s) => s.setPrefs);
  const inGame = useUiStore((s) => s.screen === 'game');
  return (
    <div className="a11y" data-testid="a11y-settings">
      <div className="a11y-row">
        <label htmlFor="ui-scale">UI scale</label>
        <input
          id="ui-scale"
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={0.05}
          value={prefs.uiScale}
          onChange={(e) => setPrefs({ uiScale: Number(e.target.value) })}
          data-testid="ui-scale"
        />
        <Stat value={`${Math.round(prefs.uiScale * 100)} %`} tooltip="Every panel, text and button scales together; the globe keeps its full resolution. 100 % is designed for a 1440 × 900 screen." inline />
      </div>
      <div className="a11y-row">
        <span>Map palette</span>
        <div className="seg">
          {(
            [
              ['default', 'Standard', 'The original red–green ramps.'],
              ['colourblind', 'Colourblind-safe', 'Okabe–Ito hues and viridis ramps: distinguishable with protanopia, deuteranopia and tritanopia, and readable by lightness alone. Also recolours good/bad values in the interface.'],
            ] as const
          ).map(([id, label, tip]) => (
            <button
              key={id}
              className={`seg-btn ${prefs.palette === id ? 'active' : ''}`}
              onClick={() => {
                setPrefs({ palette: id });
                playSound('click');
              }}
              data-tip={tip}
              data-testid={`palette-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="chips">
        <button
          className={`chip toggle ${prefs.confirmIrreversible ? 'on' : ''}`}
          onClick={() => setPrefs({ confirmIrreversible: !prefs.confirmIrreversible })}
          data-tip="Ask before declaring war, launching strikes, cyber and espionage operations, embargoes, closing straits or leaving a bloc."
          data-testid="toggle-confirm"
        >
          Confirm irreversible actions
        </button>
        <button
          className={`chip toggle ${prefs.advisor ? 'on' : ''}`}
          onClick={() => setPrefs({ advisor: !prefs.advisor })}
          data-tip="The chief of staff's three recommendations each month (key A)."
          data-testid="toggle-advisor"
        >
          Advisor (A)
        </button>
        {inGame && (
          <button
            className="chip toggle"
            onClick={() => {
              useUiStore.getState().setTutorial({ active: true, step: 0, startedTurn: 0 });
              useUiStore.getState().setModal(null);
            }}
            data-tip="Replay the five-month tutorial from the first step (key H)."
            data-testid="replay-tutorial"
          >
            Replay tutorial (H)
          </button>
        )}
      </div>
    </div>
  );
}
