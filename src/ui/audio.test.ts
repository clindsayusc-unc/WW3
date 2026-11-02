import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO, parseAudioSettings } from './audioSettings';
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
