import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO, parseAudioSettings } from './audioPrefs';
import { musicIntensityFor } from './music';

describe('audio settings (D-060)', () => {
  it('defaults to music off and clamps stored values', () => {
    expect(DEFAULT_AUDIO.musicOn).toBe(false);
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO);
    expect(parseAudioSettings('garbage')).toEqual(DEFAULT_AUDIO);
    const s = parseAudioSettings(JSON.stringify({ master: 2, effects: -1, music: 0.3, musicOn: true }));
    expect(s).toEqual({ master: 1, effects: 0, music: 0.3, musicOn: true });
    expect(parseAudioSettings(JSON.stringify({ music: 'loud' })).music).toBe(DEFAULT_AUDIO.music);
  });
  it('music intensity rises at DEFCON 2 and 1 only', () => {
    expect(musicIntensityFor(5)).toBe(0);
    expect(musicIntensityFor(3)).toBe(0);
    expect(musicIntensityFor(2)).toBe(1);
    expect(musicIntensityFor(1)).toBe(2);
  });
});

describe('score and stingers (D-084)', () => {
  it('cycles calm tracks and loops single-track playlists', async () => {
    const { nextTrack, PLAYLISTS } = await import('./music');
    expect(PLAYLISTS).toHaveLength(3);
    expect(nextTrack(2, 0)).toBe(1);
    expect(nextTrack(2, 1)).toBe(0);
    expect(nextTrack(1, 0)).toBe(0);
  });
  it('plays one stinger a month, the most important', async () => {
    const { stingerFor } = await import('./stingers');
    type S = Parameters<typeof stingerFor>[1];
    const state = (turn: number, defcon: number, log: object[] = [], extra: object = {}): S =>
      ({
        turn,
        player: 'USA',
        nations: { USA: { defcon } },
        log,
        victory: null,
        defeat: null,
        ...extra,
      }) as unknown as S;
    const a = state(3, 4);
    // Orders within a month never trigger one.
    expect(stingerFor(a, state(3, 2))).toBeNull();
    expect(stingerFor(null, a)).toBeNull();
    expect(stingerFor(a, state(4, 4))).toBeNull();
    expect(stingerFor(a, state(4, 3))).toBe('defcon');
    const log = [
      { turn: 3, kind: 'research', alert: true },
      { turn: 3, kind: 'war', alert: true },
      { turn: 2, kind: 'nuclear', alert: true },
      { turn: 3, kind: 'nuclear' },
    ];
    expect(stingerFor(a, state(4, 3, log))).toBe('war');
    expect(stingerFor(a, state(4, 4, [], { defeat: { kind: 'capitulation' } }))).toBe('defeat');
  });
});
