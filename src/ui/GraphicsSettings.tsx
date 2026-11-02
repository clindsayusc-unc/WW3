/** Quality preset, per-effect Low/Medium/High levels and the strike cam toggle (D-055, D-056). */
import { useUiStore, type Quality } from '../state/uiStore';
import {
  EFFECTS,
  LEVELS,
  LEVEL_INDEX,
  saveEffects,
  saveFlag,
  saveQuality,
  type Level,
} from '../render/quality';
import { playSound } from './audio';

const PRESET_TIP: Record<Quality, string> = {
  low: 'DPR 1, no post-processing, 96-segment sphere; every effect on Low.',
  medium: 'DPR 1.5, bloom + vignette, 160 segments; every effect on Medium.',
  high: 'DPR 2, full post-processing, 256 segments; every effect on High. Default on Apple M3.',
};

export function GraphicsSettings() {
  const quality = useUiStore((s) => s.quality);
  const effects = useUiStore((s) => s.effects);
  const autoCap = useUiStore((s) => s.autoCap);
  const strikeCam = useUiStore((s) => s.strikeCam);
  const fps = useUiStore((s) => s.fps);
  const setQuality = (q: Quality) => {
    useUiStore.getState().setQuality(q);
    saveQuality(q);
    saveEffects(useUiStore.getState().effects);
    playSound('click');
  };
  const setEffect = (key: (typeof EFFECTS)[number]['key'], level: Level) => {
    useUiStore.getState().setEffect(key, level);
    saveEffects(useUiStore.getState().effects);
    playSound('click');
  };
  return (
    <>
      <div className="section-title">Quality preset</div>
      <div className="seg">
        {(['low', 'medium', 'high'] as Quality[]).map((q) => (
          <button
            key={q}
            className={`seg-btn ${quality === q ? 'active' : ''}`}
            onClick={() => setQuality(q)}
            data-tip={PRESET_TIP[q]}
            data-testid={`quality-${q}`}
          >
            {q}
          </button>
        ))}
      </div>
      <div className="section-title">Effects</div>
      <div className="effects-grid" data-testid="effects-grid">
        {EFFECTS.map((e) => (
          <div className="effects-row" key={e.key}>
            <span className="effects-label">{e.label}</span>
            <div className="seg">
              {LEVELS.map((l) => {
                const capped = LEVEL_INDEX[l] > autoCap && effects[e.key] === l;
                return (
                  <button
                    key={l}
                    className={`seg-btn ${effects[e.key] === l ? 'active' : ''} ${capped ? 'capped' : ''}`}
                    onClick={() => setEffect(e.key, l)}
                    data-tip={e.levels[l]}
                    data-testid={`effect-${e.key}-${l}`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="hint">
        Dynamic resolution lowers render scale when frames exceed 18 ms; if the floor is reached and
        frames stay slow, every effect is capped one level lower until the frame rate recovers.
        {autoCap < 2 && (
          <>
            {' '}
            <span
              className="warn"
              data-tip={`The auto-scaler is holding effects at ${autoCap === 1 ? 'Medium' : 'Low'} because frames were slow (currently ${fps} fps).`}
              data-testid="auto-cap"
            >
              Auto-scaler active: effects capped at {autoCap === 1 ? 'Medium' : 'Low'}.
            </span>
          </>
        )}
      </p>
      <div className="chips">
        <button
          className={`chip toggle ${strikeCam ? 'on' : ''}`}
          onClick={() => {
            useUiStore.getState().setStrikeCam(!strikeCam);
            saveFlag('ww3.strikeCam', !strikeCam);
            playSound('click');
          }}
          data-tip="Follow nuclear missile launches with a short chase camera. Click, scroll or press any key to skip."
          data-testid="toggle-strike-cam"
        >
          Strike cam {strikeCam ? 'on' : 'off'}
        </button>
      </div>
    </>
  );
}
