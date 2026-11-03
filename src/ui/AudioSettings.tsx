/** Master / Effects / Music sliders and the music switch (D-060), shared by Settings and the menu. */
import { useUiStore } from '../state/uiStore';
import { applyVolumes, playSound, saveAudioSettings } from './audio';
import { Stat } from './Stat';
import type { AudioSettings as Settings } from './audioPrefs';
import { useEffect, useState } from 'react';
import { nowPlaying, PLAYLISTS, type Track } from './music';

/** Credit line for the track playing now (CC0, but credit is courteous and asked for). */
function NowPlaying({ on }: { on: boolean }) {
  const [track, setTrack] = useState<Track | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setTrack(nowPlaying()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const all = PLAYLISTS.flat()
    .map((t) => `“${t.title}” by ${t.author}`)
    .join(', ');
  return (
    <span
      className="hint"
      data-testid="now-playing"
      data-tip={`Score: ${all}. All CC0 from OpenGameArt.org.`}
    >
      {on && track
        ? `♪ “${track.title}” — ${track.author} (CC0)`
        : 'Score: CC0 tracks from OpenGameArt.org'}
    </span>
  );
}

const SLIDERS: { key: 'master' | 'effects' | 'music'; label: string; tip: string }[] = [
  {
    key: 'master',
    label: 'Master',
    tip: 'Overall volume. The mute switch sets it to silence without losing this value.',
  },
  {
    key: 'effects',
    label: 'Effects',
    tip: 'Interface clicks, orders, battles and the alert stingers (war, DEFCON, capitulation, peace, research, events). All synthesised from clean tones; the score ducks under the stingers.',
  },
  {
    key: 'music',
    label: 'Music',
    tip: 'The ambient score: CC0 tracks (credits in Settings and docs/DATA_SOURCES.md) that follow your DEFCON — calm at 5 to 3, tense at 2, crisis at 1 — crossfading as tension changes.',
  },
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
        <NowPlaying on={audio.musicOn} />
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
