/** Audio settings shape, defaults and parsing (D-060). No imports: shared by the store and audio. */

export interface AudioSettings {
  master: number;
  effects: number;
  music: number;
  musicOn: boolean;
}

export const AUDIO_KEY = 'ww3.audio';
export const MUSIC_HINT_KEY = 'ww3.musicHint';
export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, effects: 0.7, music: 0.5, musicOn: false };

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/** Parses a stored settings blob, clamping every value and filling gaps with defaults (pure). */
export function parseAudioSettings(raw: string | null): AudioSettings {
  if (!raw) return { ...DEFAULT_AUDIO };
  try {
    const o = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>>;
    return {
      master: clamp01(o.master, DEFAULT_AUDIO.master),
      effects: clamp01(o.effects, DEFAULT_AUDIO.effects),
      music: clamp01(o.music, DEFAULT_AUDIO.music),
      musicOn: typeof o.musicOn === 'boolean' ? o.musicOn : DEFAULT_AUDIO.musicOn,
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function loadAudioSettings(): AudioSettings {
  try {
    return parseAudioSettings(localStorage.getItem(AUDIO_KEY));
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function saveAudioSettings(s: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(s));
  } catch {
    /* private mode or storage disabled */
  }
}

