/** Master / Effects / Music sliders and the music switch (D-060), shared by Settings and the menu. */
import { useUiStore } from '../state/uiStore';
import { applyVolumes, playSound, saveAudioSettings } from './audio';
import { Stat } from './Stat';
import type { AudioSettings as Settings } from './audioSettings';

const SLIDERS: { key: 'master' | 'effects' | 'music'; label: string; tip: string }[] = [
  { key: 'master', label: 'Master', tip: 'Overall volume. The mute switch sets it to silence without losing this value.' },
  { key: 'effects', label: 'Effects', tip: 'Interface clicks, orders, alerts, battles. All synthesised from clean tones; no noise.' },
  { key: 'music', label: 'Music', tip: 'The ambient bed: slow minor-key pads, a sub bass and sparse piano notes, generated live. Tension rises slightly at DEFCON 2 and 1.' },
];

export function AudioSettingsPanel() {
  const audio = useUiStore((s) => s.audio);
  const muted = useUiStore((s) => s.muted);
  const setAudio = useUiStore((s) => s.setAudio);
  const update = (patch: Partial<Settings>) => {
    setAudio(patch);
    const next = { ...useUiStore.getState().audio };
    saveAudioSettings(next);
    applyVolumes(next, useUiStore.getState().muted);
  };
  return (
    <div className="audio-grid" data-testid="audio-settings">
      {SLIDERS.map((s) => (
        <label key={s.key} className="audio-row" data-tip={s.tip}>
          <span className="audio-label">{s.label}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(audio[s.key] * 100)}
            data-testid={`volume-${s.key}`}
            onChange={(e) => update({ [s.key]: Number(e.target.value) / 100 })}
            onMouseUp={() => s.key === 'effects' && playSound('order')}
          />
          <Stat value={`${Math.round(audio[s.key] * 100)}%`} tooltip={s.tip} inline />
        </label>
      ))}
      <div className="chips">
        <button
          className={`chip toggle ${audio.musicOn ? 'on' : ''}`}
          data-testid="toggle-music"
          data-tip="Ambient music bed, off by default. Fades in over a few seconds."
          onClick={() => {
            update({ musicOn: !audio.musicOn });
            playSound('click');
          }}
        >
          Music {audio.musicOn ? 'on' : 'off'}
        </button>
        <button
          className={`chip toggle ${!muted ? 'on' : ''}`}
          data-testid="toggle-mute"
          data-tip="Mute everything (keeps the volume settings)."
          onClick={() => {
            useUiStore.getState().toggleMute();
            applyVolumes(useUiStore.getState().audio, useUiStore.getState().muted);
          }}
        >
          Sound {muted ? 'off' : 'on'}
        </button>
      </div>
    </div>
  );
}
